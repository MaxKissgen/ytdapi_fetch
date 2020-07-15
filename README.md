# ytdapi_fetch
A script that periodically fetches data from the Youtube Data Api through Node.js and saves it on an arangoDB Database in order to create a social graph.

In doing so, it tries to neglect influencers that are not children or channels that don't have children involved. This is by no means perfect and done with some simple regular expressions.

A detailed documentation will be given when the script is in a somewhat final state.

Part of the Bachelor Thesis "Child Influencers within Social Media Communities"

A further disclaimer: Due to the time limits of the thesis, the script is not oriented to fully collect a channels community before moving on, but to expand onto other channels while trying to retain community proportions.
