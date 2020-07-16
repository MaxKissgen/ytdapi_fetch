const {google} = require('googleapis');
Database = require('arangojs').Database;

fs = require('fs');

//Save stuff on exit
// process.on('exit', code => {
//     console.log("Caught exit signal, saving remaining channels in file");
//
//     fs.writeFileSync("./RemainingChannels.txt", channelQueue.toString(), "utf-8");
// });

const apiKey = fs.readFileSync('./.apiKey', 'utf8');
const arangoPass = fs.readFileSync('./.arangoPass', 'utf8');

// Initialise the database variable
//TODO: Change accordingly for ginkgo
db = new Database('http+tcp://127.0.0.1:8529');
db.useBasicAuth("root", "");
//TODO: Change accordingly for ginkgo, this also potentially goes for the 'Channels/' part in the save[...] functions
db.useDatabase('Youtube');
const channelCollectionName = 'Channels';
channelCollection = db.collection(channelCollectionName);
subsCollection = db.collection('subscribed_by');
likesCollection = db.collection('videosLiked_by');
commentsCollection = db.collection('videosCommented_by');
favoritesCollection = db.collection('videosFavorited_by');

// Initialise the Youtube library with an api key
const youtube = google.youtube({
    version: 'v3',
    auth: apiKey // API key
});

// Queue class for the channelQueue
class Queue {
    constructor() {
        this.items = [];
    }

    isEmpty() {
        if (this.items.length === 0) {
            return true;
        } else {
            return false;
        }
    }

    front() {
        if (this.isEmpty()) {
            throw "Front() Error: Queue was empty!"
        }
        return this.items[0];
    }

    toString() {
        return this.items.toString();
    }

    enqueue(item) {
        this.items.push(item);
    }

    dequeue() {
        if (this.isEmpty()) {
            throw "Dequeue() Error: Queue was empty!"
        }
        this.items.shift();
    }
}

// Queue used to go through youtube channels
let channelQueue = new Queue();
let unlikelyChildQueue = new Queue();


// Map to store page tokens
let commentThreadPages = new Map();

function mapToString(map) {
    let str = "";
    let i = 0;
    for (let [key, value] of map.entries()) {
        i++;
        if (i < map.size) {
            str = str.concat(key + ":" + value + ",");
        } else {
            str = str.concat(key + ":" + value);
        }
    }
    return str;
}

function mapFromStringList(strList) {
    let map = new Map();
    let pos = 0;
    for (let x of strList) {
        const tmpList = x.split(":");
        map.set(tmpList[0], tmpList[1]);
    }

    return map;
}

async function collectChannelInfo(id) {
    return youtube.channels.list({
        "part": [
            "statistics, contentDetails"
        ],
        "id": id
    });
}

// Returns a channel object in the form of [isPotInfl: Boolean, channelInfo: channelJSON]
async function collectChannel(id) {

    let channelInfo = collectChannelInfo(id); // Collect basic channel information
    let channel = channelInfo.then(async function (resp) {
        if (resp.data.items[0].statistics.subscriberCount >= 5000) // Check whether channel is potential Influencer
        {
            let channelDetInfo = youtube.channels.list({ // Fetch detailed info
                "part": [
                    "snippet, topicDetails, status"
                ],
                "id": id
            });
            let channel = channelDetInfo.then(function (response) {
                resp.data.items.push(response.data.items[0]);
                return resp.data.items;
            });

            //channel.channelInfo = resp.data;
            //console.log(channel.channelInfo.items[0]);
            //let channel = {isPotInfl: true, channelInfo: resp};
            return [true, await channel]; // Return that the channel is an influencer along with basic and detailed info
        }

        //channel.isPotInfl = false;
        //channel.channelInfo = resp.data;
        //console.log(channel.channelInfo.items[0]);
        //let channel = {isPotInfl: true, channelInfo: resp};
        return [false, resp.data.items];//[false, resp]; // If not, just return that the channel is not an influencer along with the basic info

    });

    return await channel;
}

async function collectSubscriptions(id, pageToken) {
    if (pageToken === undefined) {
        return youtube.subscriptions.list({
            "part": [
                "snippet"
            ],
            "order": "relevance",
            "channelId": id,
            "maxResults": 50
        });
    } else {
        return youtube.subscriptions.list({
            "part": [
                "snippet"
            ],
            "order": "relevance",
            "channelId": id,
            "pageToken": pageToken,
            "maxResults": 50
        });
    }
}

//TODO: Maybe also have a pageToken-ready method
async function collectPlaylists(id) {
    return youtube.playlists.list({
        "part": [
            "snippet"
        ],
        "channelId": id,
        "maxResults": 25
    });
}

// Retrieves channelIds from  items of a specified playlist(s) at specified page. Multiple id's can be given through separating them with commas in the id string
async function collectPlaylistItems(id, pageToken) {
    if (pageToken === undefined) {
        if (id.indexOf(',') === -1) {
            return youtube.playlistItems.list({
                "part": [
                    "snippet"
                ],
                "playlistId": id,
                "maxResults": 50
            });
        } else {
            return youtube.playlistItems.list({
                "part": [
                    "snippet"
                ],
                "id": id,
                "maxResults": 50
            });
        }
    } else {
        if (id.indexOf(',') === -1) {
            return youtube.playlistItems.list({
                "part": [
                    "snippet"
                ],
                "playlistId": id,
                "pageToken": pageToken,
                "maxResults": 50
            });
        } else {
            return youtube.playlistItems.list({
                "part": [
                    "snippet"
                ],
                "id": id,
                "pageToken": pageToken,
                "maxResults": 50
            });
        }
    }
}

// Retrieves a list/array of videoId's mentioned in playlist and the next page token by pageToken
async function collectVideoIdsFromPlaylist(id, pageToken) {
    let playlistItems = collectPlaylistItems(id, pageToken);
    let videos = playlistItems.then(function (resp) {
        let tmpList = [];
        for (let x of resp.data.items) {
            //console.log(x.snippet.title);
            if (tmpList.includes(x.snippet.resourceId.videoId) === false) {
                tmpList.push(x.snippet.resourceId.videoId);
            }
        }
        return [tmpList, resp.data.nextPageToken];
    });

    return await videos;
}

// Retrieves a list/array of video infos from their id's and page token
async function collectVideoInfosFromIDList(idList, pageToken) {
    if (pageToken === undefined) {
        return youtube.videos.list({
            "part": [
                "snippet"
            ],
            "id": idList,
            "maxResults": 50
        });
    } else {
        return youtube.videos.list({
            "part": [
                "snippet"
            ],
            //"fields" : ["snippet/channelId"],
            "id": idList,
            "maxResults": 50,
            "pageToken": pageToken
        });
    }
}

// Retrieves a list/array of channelId's mentioned in playlist by id and page token
async function collectChannelsFromPlaylist(id, pageToken) {
    let channelList = [];

    let videos = collectVideoIdsFromPlaylist(id, pageToken);
    let videoInfos = videos.then(async function (resp) {
        let videoIds = resp[0].toString();

        let videoInfo = collectVideoInfosFromIDList(videoIds);

        return await videoInfo.then(function (resp) {
            return resp.data;
        });

    });

    for (let x of await videoInfos.items) {
        //console.log(x.snippet.title);
        if (channelList.includes(x.snippet.channelId) === false) {
            channelList.push(x.snippet.channelId);
        }
    }

    return [channelList, videoInfos.nextPageToken];
}

// Not done, but likes way too often private, because that is the default privacy status
//Returns the id of the likes playlist by channelId. Throws error if not found
async function collectLikes(id) {
    let playlists = collectPlaylists(id);
    let likes = playlists.then(function (resp) {
        for (let x of resp.data.items) {
            if (x.snippet.title === 'Likes') {
                return x.id;
            }
        }
        throw 'No Likes found';
    });

    return await likes;
}

// Likes way too often private, because that is the default privacy status. Therefore also favorites
//Returns the id of the favorites playlist by channelId. Throws error if not found
async function collectFavorites(id) {
    let playlists = collectPlaylists(id);
    let favourites = playlists.then(function (resp) {
        for (let x of resp.data.items) {
            if (x.snippet.title === 'Favorites') {
                return x.id;
            }
        }
        throw 'No Favourites found';
    });

    return await favourites;
}

//Retrieves CommentThreads led by a top level comment by Channel Id. These can be both for the videos and the channel
async function collectCommentThreads(id, pageToken) {
    if (pageToken === undefined) {
        return youtube.commentThreads.list({
            "part": [
                "snippet"
            ],
            "allThreadsRelatedToChannelId": id,
            "maxResults": 50
        });
    } else {
        return youtube.commentThreads.list({
            "part": [
                "snippet"
            ],
            "allThreadsRelatedToChannelId": id,
            "pageToken": pageToken,
            "maxResults": 50
        });
    }
}

//TODO: Modify method such that it tries to neglect negative comments
//Retrieves channelIds from comment-threads related to a specific channel
function collectChannelIdsFromComments(commentThreads) {
    let channelIDList = [];
    for (let x of commentThreads.data.items) {
        if (x.snippet.topLevelComment.snippet.authorChannelId !== undefined) {
            if (channelIDList.includes(x.snippet.topLevelComment.snippet.authorChannelId.value) === false) {
                channelIDList.push(x.snippet.topLevelComment.snippet.authorChannelId.value);
            }
        }
    }

    return channelIDList;
}

//Retrieves uploader channelIds from video-list
function collectChannelIdsFromVideoInfos(videoInfos) {
    let channelIDList = [];
    for (let x of videoInfos.data.items) {
        if (x.snippet.channelId !== undefined) {
            if (channelIDList.includes(x.snippet.channelId) === false) {
                channelIDList.push(x.snippet.channelId);
            }
        }
    }

    return channelIDList;
}

// Saves a channel in the database. Pretty much just takes the channel JSON object and cleans it up a bit
async function saveChannel(channel) {

    const key = channel[1][0].id;
    const contentDetails = {
        relatedPlaylists:
            {
                likes: channel[1][0].contentDetails.relatedPlaylists.likes,
                favorites: channel[1][0].contentDetails.relatedPlaylists.favorites,
            }
    };

    let doc =
        {
            _key: key,
            contentDetails: contentDetails,
            statistics: channel[1][0].statistics
        };


    let snippet, topicDetails, status;
    if (channel[0] === true) {
        snippet = {
            title: channel[1][1].snippet.title,
            description: channel[1][1].snippet.description,
            publishedAt: channel[1][1].snippet.publishedAt,
            defaultLanguage: channel[1][1].snippet.defaultLanguage,
            country: channel[1][1].snippet.country
        };

        if (channel[1][1].topicDetails !== undefined) {
            topicDetails = {
                topicCategories: channel[1][1].topicDetails.topicCategories
            }
        } else {
            topicDetails = "";
        }

        status = {
            privacyStatus: channel[1][1].status.privacyStatus, // only public ones are relevant
            isLinked: channel[1][1].status.isLinked, // true is important, otherwise topic channel
            madeForKids: channel[1][1].status.madeForKids
        }

        doc =
            {
                _key: key,
                snippet: snippet,
                contentDetails: contentDetails,
                statistics: channel[1][0].statistics,
                topicDetails: topicDetails,
                status: status
            };
    }


    await channelCollection.save(doc).then(
        meta => console.log('Channel saved:', meta._rev),
        err => {
            throw err;
        }
    );
}

//TODO: Maybe also collect activity Details. At the moment this seems too costly, however
async function saveSubscription(subscription) {
    const doc = {
        _key: subscription.id,
        _from: channelCollectionName + '/' + subscription.snippet.resourceId.channelId,
        _to: channelCollectionName + '/' + subscription.snippet.channelId,
        publishedAt: subscription.snippet.publishedAt,
        // description: subscription.snippet.description,
        // contentDetails: {
        //     activityType: subscription.contentDetails.activityType,
        // },
    };

    await subsCollection.save(doc).then(
        meta => console.log('Subscription saved:', meta._rev),
        err => {
            throw err
        }
    );
}

async function saveFavorite(channelId, favoritedVideo) {
    const doc = {
        _key: channelId + favoritedVideo.id + favoritedVideo.snippet.channelId,
        _from: channelCollectionName + '/' + favoritedVideo.snippet.channelId,
        _to: channelCollectionName + '/' + channelId,
        videoId: favoritedVideo.id,
        videoTitle: favoritedVideo.snippet.title,
        videoTags: favoritedVideo.snippet.tags
    };

    await favoritesCollection.save(doc).then(
        meta => console.log('Favorite saved:', meta._rev),
        err => {
            throw err
        }
    );
}

async function saveLike(channelId, likedVideo) {
    const doc = {
        _key: channelId + likedVideo.id + likedVideo.snippet.channelId,
        _from: channelCollectionName + '/' + likedVideo.snippet.channelId,
        _to: channelCollectionName + '/' + channelId,
        videoId: likedVideo.id
    };

    await likesCollection.save(doc).then(
        meta => console.log('Like saved:', meta._rev),
        err => {
            throw err
        }
    );
}

async function saveComment(commentThread) {
    const doc = {
        _key: commentThread.id,
        _from: channelCollectionName + '/' + commentThread.snippet.topLevelComment.snippet.channelId,
        _to: channelCollectionName + '/' + commentThread.snippet.topLevelComment.snippet.authorChannelId.value,
        videoID: commentThread.snippet.topLevelComment.snippet.videoId,
        value: commentThread.snippet.topLevelComment.snippet.textDisplay
    };

    //console.log('saving the comment');

    await commentsCollection.save(doc).then(
        meta => console.log('Comment saved:', meta._rev),
        err => {
            throw err
        }
    );

    //console.log('saved(?) the comment');
}

function waitUntilNextDay() {
    let date = new Date();

    const currDay = date.getUTCDay();

    console.log('Saving Channels');
    // Save remaining Channels
    fs.writeFileSync("./RemainingChannels.txt", channelQueue.toString(), "utf-8");
    fs.writeFileSync("./CommentPageTokens.txt", mapToString(commentThreadPages), "utf-8");

    console.log('Waiting until the quota is full again');

    // Wait until the next UTC day
    while (date.getUTCDay() === currDay) {
        date = new Date();
    }
    // After a new UTC day has started, we have to wait another 7 hours for the PST day to start since that is when the quota resets, we wait an extra one just to be sure
    date = new Date();
    let waitedHours = 0;
    let currHours = date.getUTCHours();
    while (waitedHours <= 7) {
        date = new Date();
        if (currHours !== date.getUTCHours()) // An hour has passed if true
        {
            waitedHours++;
            currHours = date.getUTCHours();
        }
    }
}

//Check for Connection to Youtube Data API through collecting Ryan's World
async function waitForConnection() {
    while (true) {
        try {
            await collectChannel('UChGJGhZ9SOOHvBB0Y4DOO_w');
            break;
        } catch (err) {
            if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                break;
            } else if (err.code !== 'ENOTFOUND') {
                throw err;
            }
        }
    }
}

//Check for Database Connection through trying to save Ryan's World
async function waitForDatabaseConnection() {
    while (true) {
        try {
            const doc = {
                "_id": channelCollectionName + "/UChGJGhZ9SOOHvBB0Y4DOO_w",
                "_key": "UChGJGhZ9SOOHvBB0Y4DOO_w",
                "snippet": {
                    "title": "Ryan's World",
                    "description": "Welcome To Ryan's World!!! Ryan loves doing lots of fun things like pretend play, science experiments, music videos, skits, challenges, DIY arts and crafts and more!!! \nMost of the toys we used to review are being donated to local charity \n\nRyan's Toys & Clothing at Walmart and Target!\n\nRyan's World \nRyan's Family Review: https://www.youtube.com/channel/UCsaOzYsyshyrYL4SHCTI8xw\nCombo Panda: https://www.youtube.com/channel/UCb69PhsHzsorirJDlxaIXlg\nGus The Gummy Gator: https://www.youtube.com/channel/UCZkSuKAy5kMnZXoxo1PrmJQ\nVTubers: https://www.youtube.com/channel/UCwOGO9gT1y0IvzPqKal4loQ\nThe Studio Space: https://www.youtube.com/channel/UCRgCbwOa1f76Ec_eRBhhezA\nFor Media Inquiries: Ryansworld@rogersandcowan.com\nFor Business Inquiries: ryantoysreviewbiz@gmail.com",
                    "publishedAt": "2015-03-17T00:18:47Z",
                    "country": "US"
                },
                "contentDetails": {
                    "relatedPlaylists": {
                        "likes": "LLhGJGhZ9SOOHvBB0Y4DOO_w",
                        "favorites": ""
                    }
                },
                "statistics": {
                    "viewCount": "40052271189",
                    "commentCount": "0",
                    "subscriberCount": "25600000",
                    "hiddenSubscriberCount": false,
                    "videoCount": "1754"
                },
                "topicDetails": {
                    "topicCategories": [
                        "https://en.wikipedia.org/wiki/Hobby",
                        "https://en.wikipedia.org/wiki/Food",
                        "https://en.wikipedia.org/wiki/Entertainment",
                        "https://en.wikipedia.org/wiki/Film",
                        "https://en.wikipedia.org/wiki/Lifestyle_(sociology)"
                    ]
                },
                "status": {
                    "privacyStatus": "public",
                    "isLinked": true,
                    "madeForKids": true
                }
            };
            await channelCollection.save(doc).then(
                meta => console.log('Channel saved:', meta._rev),
                err => {
                    throw err;
                }
            );
            break;
        } catch (err) {
            if (err.code === 409 && err.errorNum === 1210) { //Conflicting keys, meaning channel exists already
                break;
            } else if (err.code !== 'ECONNREFUSED') {
                throw err;
            }
        }
    }
}

//TODO: Better handling for unexpected errors and errors while saving objects
//TODO: Maybe don't add already saved Channels to Queue, or multiplicity can still be used as collecting more followers from that influencer
//TODO: Maybe further decide decide on page range
//TODO: Test new comment filter
async function scheduler(seedUsers) {
    channelQueue.items = seedUsers;
    let saveCounter = 0;
    let channel = {};
    let commentThreads = {};
    let subscriptions = {};
    let favorites = {};
    let favoritedVideoIds = {};
    let favoritedVideos = {};
    //let likes = {}; No Channel really has public likes, so don't use that for now
    let channelAlready = false;

    // Regexes to filter for child influencers and to filter out non-helpful big channels
    let regExp = /\b[Ff]amily|[Pp]lay|\b[Aa]ges?[^-]|\b[Cc]hild(?:dren)?\b|\b[Mm]om(?:my)?\b|\b[Mm]um\b|\b[Dd]ad(?:dy)?\b|\b[Pp]arent|\b[Dd]ress-up\b|[Yy]ears?\sold|[Tt]oy|\b[Pp]retend\b|Roblox|[Bb]rother\b|[Ss]ister\b/;
    let regExpDeutsch = /\b[Ff]amilie|[Ss]piel|\bAlter\b|\bKind(?:er)?\b|\bMam(?:mi|ma)?\b|\bPap(?:pa|pi)?\b|\bEltern|\b[Vv]erkleiden\b/;
    let regExpExclude = /\b[Oo]fficial\s(?:[Yy]outube)?\s[Cc]annel|\b[Oo]fficial\s(?:(?:[Cc]annel)|(?:[Pp]resence))/; // Seemingly often done by Shows or Celebrities not coming from Youtube


    // Debug parts here
    console.log(channelQueue.toString());
    let debugCounter = 0;

    while (channelQueue.length !== 0) {
        channelAlready = false;
        commentThreads = {data: {items: []}};
        subscriptions = {data: {items: []}};
        saveCounter++;

        // Debug part here
        // debugCounter++;

        console.log("Collecting Channel");

        // Check if Channel already exists in database
        for (let i = 0; i < 1; i++) {
            try {
                await channelCollection.document(channelQueue.front()).then(function (doc) {
                    channelAlready = true;
                    doc.id = channelQueue.front();
                    //console.log(doc);
                    channel = [false, [doc]]; //[{id: channelQueue.front()}]
                    if (doc.statistics.subscriberCount >= 5000) {
                        channel = [true, [doc, doc]];
                        //console.log(channel[1]);
                    }
                })
            } catch (err) {
                if (err.code === 'ECONNREFUSED') {
                    await waitForDatabaseConnection();
                    i--;
                }
                // Else, the channel just wasn't found so collect it.
            }
        }

        // Don't collect channel when already collected
        if (channelAlready === false) {
            // Try to collect the channel and, when quota exceeded, try again the next day
            for (let i = 0; i < 1; i++) {
                try {
                    channel = await collectChannel(channelQueue.front());
                } catch (err) {
                    if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                        waitUntilNextDay();
                        i--;
                    } else if (err.code === 'ENOTFOUND') {
                        await waitForConnection();
                        i--;
                    } else {
                        console.log(err)
                    }
                }
            }

            // Try to save the channel
            for (let i = 0; i < 1; i++) {
                try {
                    await saveChannel(channel);
                } catch (err) {
                    if (err.code === 409 && err.errorNum === 1210) { //Conflicting keys, meaning channel exists already
                        console.log("Channel was already saved - this should not have happened");
                        channelAlready = true;
                    } else if (err.code === 'ECONNREFUSED') {
                        await waitForDatabaseConnection();
                        i--;
                    } else {
                        console.log(err);
                    }
                }
            }
        }

        console.log("Channel done");

        // If the channel is an influencer candidate, also ignore those with topic or rather old practice of VEVO in title of channels
        if (channel[0] === true && channel[1][1].snippet.title.includes('Topic') === false && channel[1][1].snippet.title.includes('VEVO') === false) {
            //Check whether channel is a potential child or has children involved and if no, ignore that one and save it for later
            if (channelQueue.items.length !== 1 && regExp.test(channel[1][1].snippet.description) === false && regExpDeutsch.test(channel[1][1].snippet.description) === false) {
                //Some channels are official presences of musicians or none-Youtube celebrities, even though we might loose some child influencers like that, many of those can be deleted to concentrate on more important channels or just subscribers
                if (regExpExclude.test(channel[1][1].snippet.description) === false) {
                    console.log('Moving Channel to unlikelyChildQueue');
                    unlikelyChildQueue.enqueue(channelQueue.front());
                    channelQueue.dequeue();

                    if (channelQueue.isEmpty() === true) {
                        channelQueue.enqueue(unlikelyChildQueue.front());
                    }
                    continue;
                } else {
                    console.log('Deleting unhelpful channel');
                    channelQueue.dequeue();
                }
            }

            console.log("Collecting Comments");

            let nextPage = undefined;
            // If the channel has been visited before, then some comment pages will already exist in the Database, so jump forward to the unsaved ones
            if (commentThreadPages.has(channel[1][0].id) === true) {
                nextPage = commentThreadPages.get(channel[1][0].id);
                console.log('Moving on from nextPageToken: ' + nextPage);
            }

            // Try to collect some pages with each up to 50 commentThreads related to the channel and, when quota exceeded, try again the next day
            for (let i = 0; i < 5; i++) {
                try {
                    await collectCommentThreads(channel[1][0].id, nextPage).then(function (dat) {
                        //TODO: Maybe check for duplicates here already

                        // Can actually happen without the API returning an error code, see UCChKgkwqZm41sgqv3KyX8Hg for example
                        if (i === 0 && dat.data.items.length === 0) {
                            console.log('Empty comment List encountered, stopping comment collection');
                            i += 5;
                        }

                        commentThreads.data.items = commentThreads.data.items.concat(dat.data.items);
                        if (dat.data.nextPageToken === undefined) { // End the Loop if no more pages exist
                            i += 5;
                        } else {
                            nextPage = dat.data.nextPageToken;
                        }
                    });
                } catch (err) {
                    if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                        waitUntilNextDay();
                        i--;
                    } else if (err.code === 403 && (err.errors[0].reason === "commentsDisabled" || err.errors[0].reason === "forbidden")) {
                        console.log('(Some) comments disabled');
                        break;
                    } else if (err.code === 400 && err.errors[0].reason === "invalidPageToken") {
                        console.log('Page Token (became) invalid, trying without'); // This should happen if a channels comments have not been visited for a long time by the script, but the api doc says nothing about whether it will happen at all
                        commentThreadPages.delete(channel[1][0].id);
                        nextPage = undefined;
                        i--;
                    } else if (err.code === 404) {
                        switch (err.errors[0].reason) {
                            case "channelNotFound":
                                i += 5;
                                break;
                            case "commentThreadNotFound":
                                break;
                            default:
                                console.log(err);
                                break;
                        }
                    } else if (err.code === 'ENOTFOUND') {
                        await waitForConnection(); // Wait until connection is back
                        i--;
                    } else {
                        console.log(err);
                    }
                }
            }

            // Insert page token into comment thread map in case of revisiting later
            if (nextPage !== undefined) {
                commentThreadPages.set(channel[1][0].id, nextPage);
            }

            // Save the top level comments of those threads
            for (let i = 0; i < commentThreads.data.items.length; i++) {
                try {
                    await saveComment(commentThreads.data.items[i]);
                } catch (err) {
                    if (err.code === 409 && err.errorNum === 1210) { // Conflicting keys, meaning comment exists already
                        console.log("Comment was already saved");

                        // Remove channelId from comment so that channelIds don't get added to the queue through already saved comments
                        commentThreads.data.items[i].snippet.topLevelComment.snippet.authorChannelId = undefined;
                    } else if (err.code === 'ECONNREFUSED') {
                        await waitForDatabaseConnection();
                        i--;
                    } else {
                        console.log(err);
                    }
                }
            }

            // Add Comment authors to channelQueue
            const authorChannels = collectChannelIdsFromComments(commentThreads);

            for (let x of authorChannels) {
                // Filter out self mentions
                if (x !== channel[1][0].id) {
                    channelQueue.enqueue(x);
                }
            }

            console.log("Comments done");

        } else {

            console.log("Collecting Favorites");

            //Try to collect the id of the favorites playlist of the channel and, when quota exceeded, try again the next day
            for (let i = 0; i < 1; i++) {
                try {
                    favorites = "";
                    favorites = await collectFavorites(channel[1][0].id); //Throws an error when none found, so then favorites stays ""
                } catch (err) {
                    if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                        waitUntilNextDay();
                        i--;
                    } else if (err.code === 'ENOTFOUND') {
                        await waitForConnection();
                        i--;
                    } else if ((err.code === 403 && (err.errors[0].reason === "channelClosed" || err.errors[0].reason === "channelSuspended")) || (err.code === 404 && err.errors[0].reason === "channelNotFound")) {
                        console.log('Channel not available: ' + err.errors[0].reason);
                    } else {
                        console.log(err);
                    }
                }
            }

            //Then try to collect up to 50 favorited videos of the current channel and, when quota exceeded, try again the next day
            if (favorites !== "") {
                for (let i = 0; i < 1; i++) {
                    try {
                        favoritedVideoIds = await collectVideoIdsFromPlaylist(favorites);
                    } catch (err) {
                        if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                            waitUntilNextDay();
                            i--;
                        } else if (err.code === 'ENOTFOUND') {
                            await waitForConnection();
                            i--;
                        } else {
                            console.log(err);
                        }
                    }
                }

                //Then try to collect up to 50 "favorited" channels of the current channel through those videos and, when quota exceeded, try again the next day
                for (let i = 0; i < 1; i++) {
                    try {
                        if (favoritedVideoIds !== "") {
                            favoritedVideos = await collectVideoInfosFromIDList(favoritedVideoIds[0]);
                        } else {
                            favoritedVideos = {data: {items: []}};
                        }
                    } catch (err) {
                        if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                            waitUntilNextDay();
                            i--;
                        } else if (err.code === 'ENOTFOUND') {
                            await waitForConnection();
                            i--;
                        } else {
                            console.log(err);
                        }
                    }
                }

                //Save the favourites
                for (let i = 0; i < favoritedVideos.data.items.length; i++) {
                    try {
                        await saveFavorite(channel[1][0].id, favoritedVideos.data.items[i]);
                    } catch (err) {
                        if (err.code === 409 && err.errorNum === 1210) { //Conflicting keys, meaning channel exists already
                            console.log("Favourite was already saved");

                            // Remove channelId from video so that channelIds don't get added to the queue through already saved favourites
                            favoritedVideos.data.items[i].snippet.channelId = undefined;
                        } else if (err.code === 'ECONNREFUSED') {
                            await waitForDatabaseConnection();
                            i--;
                        } else {
                            console.log(err);
                        }
                    }
                }

                //List of favourited channelIds
                let uploaderChannels = collectChannelIdsFromVideoInfos(favoritedVideos);

                // Add favorited channelIds to queue
                for (let x of uploaderChannels) {
                    // Filter out self mentions
                    if (x !== channel[1][0].id) {
                        channelQueue.enqueue(x);
                    }
                }
            }

            console.log('Favorites done');

        }

        // As we only collect the first 100 subscriptions and therefore don't save the pageTokens, we don't have to do this part again when the channel was already visited
        if (channelAlready === false) {
            console.log("Collecting Subscriptions");

            //Try to collect some pages with up to 100 subscriptions total of the channel(sorted by relevance) and, when quota exceeded, try again the next day
            let nextPage = undefined;

            for (let i = 0; i < 2; i++) {
                try {
                    await collectSubscriptions(channel[1][0].id, nextPage).then(function (dat) {
                        subscriptions.data.items = subscriptions.data.items.concat(dat.data.items);
                        if (dat.data.nextPageToken === undefined) {
                            i++;
                        } else {
                            nextPage = dat.data.nextPageToken;
                        }
                    });
                } catch (err) {
                    if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                        waitUntilNextDay();
                        i--;
                    } else if (err.code === 403 && err.errors[0].reason === "subscriptionForbidden") {
                        break;
                    } else if (err.code === 'ENOTFOUND') {
                        await waitForConnection();
                        i--;
                    } else if ((err.code === 403 && (err.errors[0].reason === "accountClosed" || err.errors[0].reason === "accountSuspended")) || (err.code === 404 && err.errors[0].reason === "subscriberNotFound")) {
                        console.log('Channel not available: ' + err.errors[0].reason);
                    } else {
                        console.log(err);
                    }
                }
            }

            //Save the subscriptions
            for (let i = 0; i < subscriptions.data.items.length; i++) {
                //console.log("Saving Subscription " + x.id);
                try {
                    await saveSubscription(subscriptions.data.items[i]);
                    channelQueue.enqueue(subscriptions.data.items[i].snippet.resourceId.channelId);
                } catch (err) {
                    if (err.code === 409 && err.errorNum === 1210) { //Conflicting keys, meaning subscription exists already
                        console.log("Subscription was already saved");
                    } else if (err.code === 'ECONNREFUSED') {
                        await waitForDatabaseConnection();
                        i--;
                    } else {
                        console.log(err);
                    }
                }
            }

            console.log('Subs done');
        }

        console.log('\n' + 'REMAINING CHANNELS:' + (channelQueue.items.length - 1) + '\n');

        if (saveCounter === 50) {
            saveCounter = 0;
            fs.writeFileSync("./RemainingChannels.txt", channelQueue.toString(), "utf-8");
            fs.writeFileSync("./CommentPageTokens.txt", mapToString(commentThreadPages), "utf-8");
        }

        // Debug Wait
        if (debugCounter === 5) {
            console.log('Stop tests');
            waitUntilNextDay();
        }

        channelQueue.dequeue();

        //Fill with less "interesting" influencers if out of potential children or only-subscribers
        if (channelQueue.isEmpty() === true && unlikelyChildQueue.isEmpty() === false) {
            console.log('Retrieving from unlikelyChildQueue');
            channelQueue.enqueue(unlikelyChildQueue.front());
        }
    }
}

//TODO: Have functionality to collect favorites and likes simultaneously
//TODO: When collecting subscriptions, the channel description of the subscribed is already given, use that to optimise collection
//TODO: Getting favourites/likes yields a terrible behemoth of code and quota, maybe this can be more efficient?

// collectChannel('UChGJGhZ9SOOHvBB0Y4DOO_w').then(function (dat) {
// console.log(dat);
// console.log(dat[1][0]);
// });

// collectSubscriptions('UCNrInjQKQBYYWo9FjpI8F3g').then(function (dat) {
//    // console.log(dat);
//    console.log(dat.data);
// });

// collectFavorites('UCXUzReSFTL26LPutXRekZZQ').then(function (dat) {
//     //console.log(dat.data.items);
//     console.log(dat);
// });

// collectFavorites('UCXUzReSFTL26LPutXRekZZQ').then(function (dat) {
//     //console.log(dat.data.items);
//     collectPlaylistItems(dat).then(function(dat2){
//         console.log(dat2);
//     })
// });

// collectCommentThreads('UCNrInjQKQBYYWo9FjpI8F3g').then(function(dat){
//     collectChannelIdsFromComments(dat).then(function (dat2) {
//         console.log(dat2);
//     });
// });

// doc = {
//     _key: 'firstDocument',
//     a: 'foo',
//     b: 'bar',
//     c: Date()
// };
//
// channelCollection.save(doc).then(
//     meta => console.log('Document saved:', meta._rev),
//     err => console.error('Failed to save document:', err)
// );

//Person with favourites: UC2OY4ruLUWLLknZ8OG4mnsw
//Ryans World: UChGJGhZ9SOOHvBB0Y4DOO_w
//Entenburg: UCNrInjQKQBYYWo9FjpI8F3g
//GamerGirl: UCije75lmV_7fVP7m4dJ7ZoQ
//Video with comments enabled: 3bRdgQ6twPY
//Video with comments disabled: tg6GwHtS9vY
//console.log(test);

// collectChannel('UCsDUx3IrrXQI0CbfKMxTCww').then(function (dat) {
// //console.log(dat);
// //console.log(dat[1]);
//     saveChannel(dat).then(function () {
//         console.log('done');
//     }).catch(err => console.log(err));
// });

// collectSubscriptions('UChGJGhZ9SOOHvBB0Y4DOO_w').then(function (dat) {
//     // console.log(dat);
//     //console.log(dat.data.items);
//     saveSubscription(dat.data.items[0]).then(function () {
//         console.log('done');
//     }).catch(err => console.log(err));
// }).catch(err => console.log(err.code + "\n" + err.errors[0].reason));

// collectFavorites('UC2OY4ruLUWLLknZ8OG4mnsw').then(function (dat) {
//     // console.log(dat);
//     //console.log(dat.data);
//     collectVideoIdsFromPlaylist(dat).then(function (dat2) {
//         //console.log(dat2);
//         collectVideoIdsFromPlaylist(dat, dat2[1]).then(function (dat3) {
//             collectVideoInfosFromIDList(dat3[0]).then(function (dat4) {
//                 console.log(dat4.data.items[0]);
//                      saveFavorite('UC2OY4ruLUWLLknZ8OG4mnsw', dat4.data.items[0]).then(function(){
//                          console.log('done');
//                      });
//             });
//         });
//     });
//
// });

// collectCommentThreads('UChGJGhZ9SOOHvBB0Y4DOO_w', 'CAoQAA').then(function(dat){
//     console.log(dat.data.items[0].snippet.topLevelComment.snippet);
//     saveComment(dat.data.items[0]).then(function() {
//         console.log('done');
//     });
// }).catch(err => console.log(err.code + "\n" + err.errors[0].reason));

//UCfXI3c8AWF3smkqRM2Iiaxw,UC4pDKMzp7BMUrj1vxPqIMCw,UCNm8WjumwijTwIVmCOLi0KQ,UCMDoGQEBNf-yBnUXugkjSYA

//McClure: UCNm8WjumwijTwIVmCOLi0KQ
// Self favoriting person: UCumttzRvENB4ECoDd7Uuzow
//list: ['UChGJGhZ9SOOHvBB0Y4DOO_w', 'UCHa-hWHrTt4hqh-WiHry3Lw', 'UCfXI3c8AWF3smkqRM2Iiaxw', 'UCXa9irCtpM1t4l2cPuBKcQg', 'UC4pDKMzp7BMUrj1vxPqIMCw', 'UCNm8WjumwijTwIVmCOLi0KQ', 'UCMDoGQEBNf-yBnUXugkjSYA', 'UC6sSkkemzPjmrzS0Y0V_2zw', 'UCZsDDuoeSVgpgy3zWLAhArw', 'UCwlHYiYchPT-xcJquyBbvRQ', 'UCDKN0w9ZvbFED0nUbBPLV6A', 'UCgYQ_-hKHVtevMpqaJSHnQw', 'UCC-RHF_77zQdKcA75hr5oTQ']

try {
    let channels = fs.readFileSync("./RemainingChannels.txt", 'utf-8');
    let pageTokens = fs.readFileSync("./CommentPageTokens.txt", 'utf-8');

    //Debug Part
    //channels = "";
    //pageTokens = "";

    if (pageTokens !== "") {
        commentThreadPages = mapFromStringList(pageTokens.split(","));
    }

    if (channels === "") {
        scheduler(['UChGJGhZ9SOOHvBB0Y4DOO_w', 'UCHa-hWHrTt4hqh-WiHry3Lw', 'UCfXI3c8AWF3smkqRM2Iiaxw', 'UCXa9irCtpM1t4l2cPuBKcQg', 'UC4pDKMzp7BMUrj1vxPqIMCw', 'UCNm8WjumwijTwIVmCOLi0KQ', 'UCMDoGQEBNf-yBnUXugkjSYA', 'UC6sSkkemzPjmrzS0Y0V_2zw', 'UCZsDDuoeSVgpgy3zWLAhArw', 'UCwlHYiYchPT-xcJquyBbvRQ', 'UCDKN0w9ZvbFED0nUbBPLV6A', 'UCgYQ_-hKHVtevMpqaJSHnQw', 'UCC-RHF_77zQdKcA75hr5oTQ']);
    } else {
        scheduler(channels.split(","));
    }

} catch (err) {
    console.log(err);
    fs.writeFileSync("./RemainingChannels.txt", channelQueue.toString(), "utf-8");
    fs.writeFileSync("./CommentPageTokens.txt", mapToString(commentThreadPages), "utf-8");
}


{
    const testString1 = "Hi! Welcome to FamousTubeKIDS. This channel is all about us (Cali & Kameiro) having fun... From dress-up to playing with our favourite toys, you're bound to have a great time here! Subscribe for weekly videos.\n" +
        "\n" +
        "SEE YOU SOON :)\n" +
        "\n" +
        "This channel is managed by a parent.\n" +
        "\n" +
        "For business inquiries please email us at famoustubekids@gmail.com";

    const testString2 = "Hey guys! I'm Gavin Magnus, and welcome to my fun and crazy life! I enjoy creating funny videos including 24 hour challenges, girlfriend challenges, trending and sometimes messy challenges,  last to challenges, and simple day in the life vlogs. I'm usually always with my funny friends or my crush Coco Quinn.  I have an epic new song called \"Catching Feelings\" that is awesome for all ages!\n" +
        "\n" +
        "I want to thank my #goatfam for always being loyal and watching every prank, challenge, and vlog I do. \n" +
        "If you’re new to my channel, make sure you SUBSCRIBE and hit that 🛎 to see my newest videos and to be a part of the Goat Fam!\n" +
        "\n" +
        "You may have seen:\n" +
        "\"Crushin\"  w/ 22 million views.\n" +
        "\"Seniorita\" w/ 40 million views \n" +
        "\"It's You\" w/ 6 million  views\n" +
        "\"Catching Feelings\" w/ 5 million views\n" +
        "\n" +
        "Instagram -  @gavinmagnus";

    const testString3 = "Welcome to my channel! I’m Sarah Dorothy Little, and I love making videos with my friends and family. I cover mostly beauty, challenges, skits, and anything else I’m doing that I think you might enjoy. I also love music, so you’ll see me rap, sing, and dance -- checkout my original song Catch My Woah. I’m a member of the Gavin Magnus #GoatFam, so checkout those videos in my Playlist!\n" +
        "\n" +
        "I live on a ranch near Yosemite with 3 dogs, 3 cats, 3 alpacas, 2 llamas, 16 chickens, 2 brothers, and my parents. I also live in LA part time, so I get to be a country girl and a city girl! I love playing volleyball and watching my favorite shows on Netflix, like Vampire Diaries.\n" +
        "\n" +
        "Subscribe and turn on notifications to keep up with my crazy-fun life! (Parent run account.)\n" +
        "You can follow me on these other social media platforms:\n" +
        "\n" +
        "Instagram and TikTok: @sarahdorothylittle\n" +
        "Twitter: @sarahdorothylit\n" +
        "Facebook: facebook.com/sarahdorothylittle\n" +
        "\n" +
        "Fan Mail:\n" +
        "Sarah Dorothy Little\n" +
        "PO Box 2883\n" +
        "Oakhurst, CA 93644";

    const testString4 = "Welcome to THE ACE FAMILY channel. Join The ACE Family and SUBSCRIBE! Our videos include vlogs, crazy experiences, challenges, pranks, and fun family times.\n" +
        "SUBSCRIBE HERE: http://bit.ly/THEACEFAMILY\n" +
        "\n" +
        "STALK US :)\n" +
        "\n" +
        "Catherine's Instagram: https://www.instagram.com/catherinepaiz/\n" +
        "Catherine's Twitter: http://twitter.com/catherinepaiz\n" +
        "Catherine's SnapChat: Catherinepaiz\n" +
        "\n" +
        "Austin's Instagram: https://www.instagram.com/austinmcbroom/\n" +
        "Austin's Twitter: https://twitter.com/AustinMcbroom\n" +
        "Austin's SnapChat: TheRealMcBroom\n" +
        "\n" +
        "THE ACE FAMILY official Facebook Page https://www.facebook.com/The.ACE.Family/\n" +
        "Business inquires: acehatcollection@gmail.com";

    const testString5 = "WHATS UP?! Im Jake Paul.\n" +
        "Im 22, live in Los Angeles, & have a crazy life! Keep up :) \n" +
        "The squad \"Team 10\" & I are always making comedy vids, acting, doing action sports, & going on crazy adventures. \n" +
        "Subscribe & watch daily to keep up with the madness \n" +
        "JAKE PAULERS FOR LIFE\n" +
        "\n" +
        "FAHLO ME OTHER SOCIAL MEDIAS \n" +
        "Instagram: jakepaul\n" +
        "Twitter: jakepaul\n" +
        "Snapchat: jakepaul19\n" +
        "\n" +
        "Oh... and you can text me: 310-870-3349\n" +
        "\n" +
        "Business: jake@team10official.com";

    const testString6 = "We are a positive lifestyle brand centering content around our identical twins, Ava and Alexis, aka \"the McClure Twins\". Other members of the family are Justin (Dad), Ami (Mom), and Jersey (he has his own channel, below). \n" +
        "Our content is \"vlog\" style, based on reality, and leans more to women's audience with sprinkled life lessons and good parenting:)\n" +
        "We are a Forbes Top Influencer, Shorty Awards finalist, and we've been featured on CBS and Good Morning America.\n" +
        "\n" +
        "Thanks for learning more about us! Inquries: themccluretwins@gmail.com\n" +
        "\n" +
        "Follow Instagram:\n" +
        "@mccluretwins \n" +
        "@just _aminat\n" +
        "@jkmcclure\n" +
        "@jerseytayomcclure\n" +
        "\n" +
        "Playtime with Jersey : https://www.youtube.com/channel/UCHaROGr_2_YLh25L8EhBJ-w";

    const testString7 = "Shalom guys, I’m Piper Rockelle I’m a girl living my dream in Hollywood. On this channel we believe in entertainment, quality, family, fun, love, and good vibes. Here you can find me doing crazy challenges. Boyfriend challenges, crush challenges,  24 hour challenges, last to challenges, and more. Also I do DIYs, tutorials, make up, instagram videos. Normally I’m with an awesome friend, or crush, or boyfriend in my videos. Along with all this my videos are great for boys and girls of all ages, even adults! I hope I am able to make you laugh or cheer up if you’re having a bad day.\n" +
        "DON’T forget to follow my Instagram @ PiperRockelle , there you can find more about me and my other passions in music and dance.\n\n" +
        "You may have seen\n" +
        "Piper Rockelle - Treat Myself (Official Music Video) **FIRST KISS** 💋\n" +
        "I LOST MY MEMORY PRANK ON MY BOYFRIEND **Gone Too Far**🤕💔\n" +
        "Recreating VIRAL Couples TikToks With My CRUSH Challenge ❤️🔥\n\n" +
        "Instagram - PiperRockelle\n" +
        "Twitter - PiperRockelle";

    const testString8 = "Official YouTube for Lilly K! Age: 11";

    const testString9 = "Danielle \"Dani\" Cohn is a 15 year old American actress, model, social media sensation, and recording artist signed with Audity Music. In 2014 she was crowned Miss Florida Jr. Preteen, and has since attracted over 11 million fans via Musical.ly, Instagram, Youtube, and Twitter.";
}

// let regExp = /\b[Ff]amily|[Pp]lay|\b[Aa]ges?[^-]|\b[Cc]hild(?:dren)?\b|\b[Mm]om(?:my)?\b|\b[Mm]um\b|\b[Dd]ad(?:dy)?\b|\b[Pp]arent|\b[Dd]ress-up\b|[Tt]oy|\b[Pp]retend\b|[Yy]ears?\sold|Roblox/;
// let regExpDeutsch = /\b[Ff]amilie|[Ss]piel|\bAlter\b|\bKind(?:er)?\b|\bMam(?:mi|ma)?\b|\bPap(?:pa|pi)?\b|\bEltern|\b[Vv]erkleiden\b/;
//
//
// console.log(regExp.test(testString1));
// console.log(regExp.test(testString2));
// console.log(regExp.test(testString3));
// console.log(regExp.test(testString4));
// console.log(regExp.test(testString5)); // should be false
// console.log(regExp.test(testString6));
// console.log(regExp.test(testString7));
// console.log(regExp.test(testString8));
// console.log(regExp.test(testString9));
//console.log(regExp.test("Daddydy"));

//fs.writeFileSync("./RemainingChannels.txt", channelQueue.toString(), "utf-8");

//waitUntilNextDay();


// //Save stuff on exit
// process.on('exit', code => {
//     console.log("Caught exit signal, saving remaining channels in file");
//
//     fs.writeFileSync("./RemainingChannels.txt", channelQueue.toString(), "utf-8");
//
//     process.exit(code);
// });
//
// //Save stuff on exit
// process.on('SIGINT', () => {
//     console.log("Caught exit signal, saving remaining channels in file");
//
//     fs.writeFileSync("./RemainingChannels.txt", channelQueue.toString(), "utf-8");
//
//     process.exit();
// });
//
// //Save stuff on exit
// process.on('SIGTERM', () => {
//     console.log("Caught exit signal, saving remaining channels in file");
//
//     fs.writeFileSync("./RemainingChannels.txt", channelQueue.toString(), "utf-8");
//
//     process.exit();
// });

// waitForConnection().then(function () {
//     console.log('Connected');
// })

// waitForDatabaseConnection().then(function () {
//     console.log('Connected to Database');
// });
