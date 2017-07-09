/*
 * @author Jason Lin, forked from Facebook.
 * jason0@stanford.edu
 * Reddit Memer Messenger chatbot - 
 * recommends new subreddits based on user input. 
 */

/* jshint node: true, devel: true */
'use strict';

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request'),
  promise = require('promise'),
  rp = require('request-promise'),
  fs = require('fs'),
  Promise = require('bluebird'),
  num_types = 959198,
  num_docs = 3490408;

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

var stopwords = [];
var subredditData = {};

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Webhook validation.
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});


/*
 * Handle Messenger callbacks. 
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    res.sendStatus(200);
  }
});

/*
 * Verify that the callback came from Facebook. U
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event.
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam, 
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to the page. 
 * The bot only responds to text messages and attempts to calculate
 * the best subreddit based on the text received. 
 * 
 */
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", 
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;

  if (messageText) {
    var best_subreddit = getBestSubreddit(messageText, senderID);
    if (best_subreddit == "miela") {
      sendTextMessage(senderID, "Sorry, that is too specific for my data to handle! Give me some more common words.");
    } else if (best_subreddit == "All stop words") {
      sendTextMessage(senderID, "Sorry, but can you use some more specific words? The words you used are way too common!");
    } else {
      sendSubreddit(best_subreddit, senderID);
    }
  } else if (messageAttachments) {
    sendImageMessage(senderID);
    sendTextMessage(senderID, "Sorry, I don't know what to do with that!");
  }
}

/*
 * Calculate best subreddit using Naive Bayes with Laplace smoothing.
 */
function getBestSubreddit(messageText, senderID) {
  var user_words = parse_message(messageText);
  if (user_words.length == 0) {
    return "All stop words";
  }
  var top_score = Number.MIN_SAFE_INTEGER;
  var top_subreddit = "";
  for (var sub in subredditData) {
    if (subredditData.hasOwnProperty(sub)) {
      var subreddit = subredditData[sub];
      var score = 0.0;
      var word_count = subreddit["word_count"];
      var doc_count = subreddit["doc_count"];
      for (var word_index = 0; word_index < user_words.length; word_index++) {
        if (user_words[word_index] in subreddit["word_freqs"]) {
          score += Math.log(subreddit["word_freqs"][user_words[word_index]]);
        } else {
          score += Math.log(1);
        }
        score -= Math.log(word_count + num_types);
      }
      score += Math.log(num_docs);
      score -= Math.log(doc_count);
      if (score > top_score) {
        top_score = score;
        top_subreddit = sub;
      }
    }     
  }
  return top_subreddit;
}

/*
 * Parse message to remove stop words and non alphanumeric characters.
 */
function parse_message(messageText) {
  var user_words = messageText.toLowerCase();
  user_words = user_words.split(" ");
  for (var i = 0; i < user_words.length; i++) {
    user_words[i] = user_words[i].replace(/[^A-Za-z0-9]/g, "");
  }
  var final_words = [];
  for (var i = 0; i < user_words.length; i++) {
    if (!stopwords.has(user_words[i]) && user_words[i] != "") {
      final_words.push(user_words[i]);
    }
  }
  return final_words
}

/*
 * Send information about a subreddit using a generic template.
 */
function sendSubreddit(best_subreddit, senderID) {
  rp("https://www.reddit.com/r/" + best_subreddit + "/.json?limit=2").then(function(res) {
    res = JSON.parse(res);
    var postlist = res["data"]["children"];
    var topPost = {};
    for (var i = 0; i < 3; i++) {
      if (!postlist[i]["data"]["stickied"]) {
        topPost = postlist[i]["data"];
        break;
      }
    }
    var messageTitle = topPost["title"];
    if (messageTitle.length > 80) {
      messageTitle = messageTitle.substring(0,80);
    }
    var messageSubtitle = topPost["selftext"];
    if (messageSubtitle.length > 80) {
      messageSubtitle = messageSubtitle.substring(0,80);
    }
    var imgUrl = "";
    if ("preview" in topPost) {
      imgUrl = topPost["preview"]["images"][0]["source"]["url"];
    } else {
      imgUrl = SERVER_URL + "/assets/reddit-alien.png";
    }
    var linkUrl = topPost["url"];
    var messageData = {
      recipient :{
        id: senderID
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{
              title: messageTitle,
              subtitle: messageSubtitle,
              item_url: linkUrl,           
              image_url: imgUrl,
              buttons: [{
                type: "web_url",
                url: "https://www.reddit.com/r/" + best_subreddit,
                title: "Visit /r/" + best_subreddit
              }]
            }]
          }
        }
      }
    }
    callSendAPI(messageData);
  });
}

/*
 * Delivery Confirmation Event.
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s", 
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event.
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " + 
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to 
  // let them know it was successful
  introduce(senderID);
}

/*
 * Has the chatbot introduce itself, customizing the greeting to the user's gender.
 */
function introduce(senderID) {
  rp("https://graph.facebook.com/v2.6/" + senderID + "?access_token=" + PAGE_ACCESS_TOKEN).then(function(res) {
    res = JSON.parse(res);
    var greetingName = "";
    if (res["gender"] == "male") {
      greetingName = "m'good sir";
    } else if (res["gender"] == "female") {
      greetingName = "m'lady";
    } else {
      greetingName = res["first_name"];
    }
    var greeting = "Greetings " + greetingName + "! I am delighted to make your acquaintance.";
    sendTextMessage(senderID, greeting);
    askFirstQuestion(senderID);
  });
}

function askFirstQuestion(senderID) {
   setTimeout(function() {
    sendTextMessage(senderID, "Tell me something about yourself and I'll recommend a subreddit to you.");
   }, 2000);
}

/*
 * Message Read Event.
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Send a text message using the Send API.
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;
      if ("attachment" in messageData["message"] && messageData["message"]["attachment"]["type"] == "template") {
        sendTextMessage(messageData["recipient"]["id"], "What do you think of this fine subreddit? Here's the current top post!");
      }
      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });  
}

/*
 * Make set of stop words from text file.
 */
function makeStopWordSet() {
  stopwords = new Set(fs.readFileSync('englishstop.txt').toString().split("\n"));
}

/* 
 * Parse subreddit data from text file. 
 */
function makeData() {
  console.log("Begin reading data file...");
  subredditData = fs.readFileSync('data.txt').toString();
  console.log("Begin parsing result to JSON...");
  subredditData = JSON.parse(subredditData);
  console.log("Done reading data, JSON object ready!");
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
  makeStopWordSet();
  makeData();
});

module.exports = app;
