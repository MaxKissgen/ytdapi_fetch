# ytdapi_fetch
A script that periodically fetches data from the Youtube Data Api through Node.js and saves it on an arangoDB Database in order to create a social graph.

In doing so, it tries to neglect influencers that are not children or channels that don't have children involved. This is by no means perfect and done with some simple regular expressions

Part of the Bachelor Thesis "Child Influencers within Social Media Communities"
