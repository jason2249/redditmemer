# Reddit Memer
*@author Jason Lin, jason0@stanford.edu*

New to Reddit? Or just looking for more subreddits to waste time with? Then look no further! The Reddit Memer chatbot uses basic machine learning to recommend a subreddit catered to your interests. 

## Usage

Simply visit www.facebook.com/redditmemer and click **Send Message** to get started with the chatbot. This may take a while to start up since I'm too cheap and am using the free dyno from Heroku.

The chatbot will prompt you for information about yourself, and then will attempt to recommend a subreddit. Some questions you can answer about yourself are:
* What do you like to do in your spare time?
* How would you describe yourself?
* Is there anything you want to learn about?

When a subreddit is recommended, it pulls the current top post from that subreddit and sends it along with a link to the subreddit itself for your viewing pleasure.

## Design

To get started with this project, I first needed data, and lots of it. Thankfully, I was able to use nearly 32 gigabytes of reddit comments as my dataset thanks to [this](https://www.reddit.com/r/datasets/comments/3bxlg7/i_have_every_publicly_available_reddit_comment/) reddit post! 

Next, I filtered down those 32 gigabytes of comments by selecting only those with score of 10 or higher. This was to avoid junk comments and comments that were downvoted. I didn't want to use downvoted comments because if they were downvoted, they wouldn't as accurately represent the sentiment of a certain subreddit. 

I used a Naive Bayes classifier with Laplace smoothing to classify user input words into a recommended subreddit. 

When calculating scores for words, I chose to binarize the word frequencies per comment because we don't want one comment with 50 mentions of the word "Harry Potter" in a random subreddit to be weighted more than 30 different mentions of "Harry Potter" in the actual Harry Potter subreddit!

I used Laplace add-1 smoothing to account for words entered by the user but not seen in the comment data, because it's very likely that the word not seen has been mentioned in the subreddit, just not enough to show up significantly. 

Finally, in order to promote the finding of more unique subreddits, instead of multiplying the final scores by the log frequency of the subreddit, I multiplied final scores by the **inverse** log frequencies of their subreddits. This was to ensure huge subreddits such as AskReddit did not dominate every result and new, smaller, and interesting subreddits were able to be discovered!

## Credits 

Thanks to:
/u/stuck_in_the_matrix for the comments dataset,
Facebook for the messenger bot starter code,
Reddit for the awesome website,
and CS109 and CS124 for teaching me about the Naive Bayes classifier!