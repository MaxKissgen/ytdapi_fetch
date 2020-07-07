const {google} = require('googleapis');
Database = require('arangojs').Database;

fs = require('fs');

const apiKey = fs.readFileSync('./.apiKey', 'utf8');
const arangoPass = fs.readFileSync('./.arangoPass', 'utf8');

// Initialise the database variable
//TODO: Change accordingly for ginkgo
db = new Database('http://127.0.0.1:8529');
db.useBasicAuth("root", arangoPass);

//TODO: Change accordingly for ginkgo, this also potentially goes for the 'Channels/' part in the save[...] functions
db.useDatabase('testBase');
channelCollection = db.collection('Channels');
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
            "channelId": id,
            "maxResults": 50
        });
    } else {
        return youtube.subscriptions.list({
            "part": [
                "snippet"
            ],
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
            "pageToke": pageToken,
            "maxResults": 50
        });
    }
}

//TODO: Modify method such that it tries to neglect negative comments
//TODO: Check what happens if id unavailable
//Retrieves ChannelIds from comment-threads related to a specific channel
async function collectChannelIdsFromComments(commentThreads) {
    let channelIDList = [];
    for (let x of commentThreads.data.items) {
        if (channelIDList.includes(x.snippet.topLevelComment.snippet.authorChannelId.value) === false) {
            channelIDList.push(x.snippet.topLevelComment.snippet.authorChannelId.value);
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

        topicDetails = {
            topicCategories: channel[1][1].topicDetails.topicCategories
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


    channelCollection.save(doc).then(
        meta => console.log('Channel saved:', meta._rev),
        err => {
            throw err
        }
    );
}

//TODO: Maybe also collect activity Details. At the moment this seems too costly, however
async function saveSubscription(subscription) {
    const doc = {
        _key: subscription.id,
        _from: 'Channels/' + subscription.snippet.resourceId.channelId,
        _to: 'Channels/' + subscription.snippet.channelId,
        publishedAt: subscription.snippet.publishedAt,
        // description: subscription.snippet.description,
        // contentDetails: {
        //     activityType: subscription.contentDetails.activityType;
        // },
    };

    subsCollection.save(doc).then(
        meta => console.log('Subscription saved:', meta._rev),
        err => {
            throw err
        }
    );
}

async function saveFavorite(channelId, favoritedVideo) {
    const doc = {
        _key: channelId + favoritedVideo.id + favoritedVideo.snippet.channelId,
        _from: 'Channels/' + favoritedVideo.snippet.channelId,
        _to: 'Channels/' + channelId,
        videoId: favoritedVideo.id,
        videoTitle: favoritedVideo.snippet.title,
        videoTags: favoritedVideo.snippet.tags
    };

    favoritesCollection.save(doc).then(
        meta => console.log('Favorite saved:', meta._rev),
        err => {
            throw err
        }
    );
}

async function saveLike(channelId, likedVideo) {
    const doc = {
        _key: channelId + likedVideo.id + likedVideo.snippet.channelId,
        _from: 'Channels/' + likedVideo.snippet.channelId,
        _to: 'Channels/' + channelId,
        videoId: likedVideo.id
    };

    likesCollection.save(doc).then(
        meta => console.log('Like saved:', meta._rev),
        err => {
            throw err
        }
    );
}

async function saveComment(commentThread) {
    const doc = {
        _key: commentThread.id,
        _from: 'Channels/' + commentThread.snippet.topLevelComment.snippet.channelId,
        _to: 'Channels/' + commentThread.snippet.topLevelComment.snippet.authorChannelId.value,
        videoID: commentThread.snippet.topLevelComment.snippet.videoId,
        value: commentThread.snippet.topLevelComment.snippet.textDisplay
    };

    commentsCollection.save(doc).then(
        meta => console.log('Comment saved:', meta._rev),
        err => {
            throw err
        }
    );
}

function waitUntilNextDay() {
    let date = new Date();

    const stopTime = date.getTime();

    console.log('Waiting until the quota is full again');

    while (date.getTime() < stopTime + 86400000) ; //86.400.000 is all milliseconds in one day

}

//TODO: Test out everything with page tokens and incorporate page tokens in scheduler
//TODO: More individual try/catch
//TODO: Better handling for unexpected errors and errors while saving objects
//TODO: Don't add already saved Channels to Queue --> ask Database first
//TODO: Get multiple pages of subscriptions/comments/videos
async function scheduler(seedUsers) {
    channelQueue.items = seedUsers;
    let channel = {};
    let commentThreads = {};
    let subscriptions = {};
    let favorites = {};
    let favoritedVideos = {};
    let likes = {};

    console.log(channelQueue.toString());

    while (channelQueue.length !== 0) {
        //Try to collect the channel and, when quota exceeded, try again the next day
        try {
            channel = await collectChannel(channelQueue[0])
        } catch (err) {
            if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                waitUntilNextDay();
                channel = await collectChannel(channelQueue[0]);
            } else {
                console.log(err)
            }
        }

        //Try to save the channel
        try {
            await saveChannel(channel);
        } catch (err) {
            console.log(err);
        }

        if (channelQueue.front()[0] === true) // if the channel is an influencer candidate
        {
            //Try to collect up to 50 commentThreads related to the channel and, when quota exceeded, try again the next day
            try {
                commentThreads = await collectCommentThreads(channel[1].id);
            } catch (err) {
                if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                    waitUntilNextDay();
                    commentThreads = await collectChannel(channel);
                } else {
                    console.log(err);
                }
            }

            //Save the top level Comments of those Threads
            for (let x of commentThreads.data.items) {
                try {
                    await saveComment(x);
                } catch (err) {
                    console.log(err);
                }
            }

            const authorChannels = collectChannelIdsFromComments(commentThreads);

            for (let x of authorChannels) {
                channelQueue.enqueue(x);
            }

        } else {

            //Try to collect up to 50 subscriptions of the channel and, when quota exceeded, try again the next day
            try {
                subscriptions = await collectSubscriptions(channelQueue[0]);
            } catch (err) {
                if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                    waitUntilNextDay();
                    subscriptions = await collectSubscriptions(channelQueue[0]);
                } else {
                    console.log(err)
                }
            }

            //Save the subscriptions
            for (let x of subscriptions.data.items) {
                try {
                    await saveSubscription(x);
                } catch (err) {
                    console.log(err);
                }
            }

            //Try to collect the id of the favorites playlist of the channel and, when quota exceeded, try again the next day
            try {
                favorites = await collectFavorites(channelQueue[0]);
            } catch (err) {
                if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                    waitUntilNextDay();
                    favorites = await collectFavorites(channelQueue[0]);
                } else {
                    console.log(err)
                }
            }
            //Then try to collect up to 50 "favorited" Channels of the current channel and, when quota exceeded, try again the next day
            try {
                favoritedVideos = await collectVideosFromPlaylist(favorites);
            } catch (err) {
                if (err.code === 403 && err.errors[0].reason === "quotaExceeded") {
                    waitUntilNextDay();
                    favoritedVideos = await collectVideosFromPlaylist(favorites);
                } else {
                    console.log(err)
                }
            }

            //Save the favourites and add them to th queue
            for (let x of favoritedVideos[0]) {
                try {
                    channelQueue.push(x.snippet.channelId);
                    await saveFavorite(channelQueue[0], x);
                } catch (err) {
                    console.log(err);
                }
            }

        }

        channelQueue.dequeue();
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
//Video with comments enabled: 3bRdgQ6twPY
//Video with comments disabled: tg6GwHtS9vY
//console.log(test);

// collectChannel('UChGJGhZ9SOOHvBB0Y4DOO_w').then(function (dat) {
// //console.log(dat);
// //console.log(dat[1][0]);
//     saveChannel(dat).then(function () {
//         console.log('done');
//     });
// });

// collectSubscriptions('UCNrInjQKQBYYWo9FjpI8F3g').then(function (dat) {
//     // console.log(dat);
//     //console.log(dat.data.items);
//     saveSubscription(dat.data.items[0]).then(function(){
//         console.log('done');
//     })
// });

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

// collectCommentThreads('UCNrInjQKQBYYWo9FjpI8F3g').then(function(dat){
//     console.log(dat.data.items[0].snippet.topLevelComment.snippet);
//     saveComment(dat.data.items[0]).then(function() {
//         console.log('done');
//     });
// });

//try{
//scheduler(['UChGJGhZ9SOOHvBB0Y4DOO_w', 'UCNrInjQKQBYYWo9FjpI8F3g']);}
//catch(err){writeFile(remainingChannels.txt, channelQueue.toString(), (error) => {
//
//     // In case of a error throw err exception.
//     if (error) throw err;
// }));}

//waitUntilNextDay();

console.log('test');
