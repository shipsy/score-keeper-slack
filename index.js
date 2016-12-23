var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var request = require('request');
var MongoClient = require('mongodb').MongoClient

app.set('port', (process.env.PORT || 5000));

// app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: false }));


var doAddition = function(splitted, requestBody) {
	var groupName = splitted[1];
	if (!groupName)
		return Promise.reject(createError('Group name should be present'));
	groupName = groupName.toLowerCase();

	var thingName = splitted[2];
	if (!thingName)
		return Promise.reject(createError('Name should be present'));
	if (thingName[0] !== '@')
		return Promise.reject(createError('Name should start with \'@\''));

	var change = splitted[3];
	if (!change)
		change = 1;
	if (isNaN(change))
		return Promise.reject(createError('Score should be a number'));
	change = Math.ceil(Number(change));
	if (change === 0)
		return Promise.reject(createError('Change not allowed'));
	var currentTime = new Date();

	return app.db.collection('groups').update(
		{
			name: groupName
		},
		{
			$inc: {
				['scores.' + thingName]: change
			},
			// $push: {
			// 	history: {
			// 		createdAt: new Date(),
			// 		createdById: requestBody.user_id,
			// 		createdByName: requestBody.user_name,
			// 		channelId: requestBody.channel_id,
			// 		channelName: requestBody.channel_name,
			// 		thingName: thingName,
			// 		change: change
			// 	}
			// },
			$setOnInsert: { 
				createdAt: currentTime
			}
		},
		{upsert: true}
	)
	.then(function() {
		return app.db.collection('scoreHistory').insert({
			groupName: groupName,
			createdAt: currentTime,
			createdById: requestBody.user_id,
			createdByName: requestBody.user_name,
			channelId: requestBody.channel_id,
			channelName: requestBody.channel_name,
			thingName: thingName,
			change: change
		});
	});
};


function getScores(splitted, requestBody) {
	var groupName = splitted[1];
	if (!groupName)
		return Promise.reject(createError('Group name should be present'));
	groupName = groupName.toLowerCase();

	return app.db.collection('groups').findOne(
		{
			name: groupName
		},
		{
			fields: {scores: 1}
		}
	)
	.then(function(result) {
		var scoreList = Object.keys(result.scores)
			.map((key) => {return {name: key, score: result.scores[key]}})
			.sort((a, b) => {return b.score - a.score});

		return scoreList.map(function(elem) {
			return elem.name + ' : ' + elem.score;
		})
		.join('\n');
	});

}

app.post('/', function(req, res) {
	// var payloadOption = createResponsePayload(req.body);
	// if (payloadOption.error) {
	// 	response.end(payloadOption.error);
	// 	return;
	// }
	// request({
	// 	url: process.env.POSTBACK_URL,
	// 	json: payloadOption,
	// 	method: 'POST'
	// }, function (error) {
	// 	if(error) {
	// 		response.end('Unable to post your anonymous message: ' + JSON.stringify(error));
	// 	} else {
	// 		response.end('Delivered! :cop:');
	// 	}

	// });

	var errorHandler = function(err) {
		console.log(err);
		var textToSend = '';
		if (err.isMine)
			textToSend = err.message || 'Some error occured';
		else
			textToSend = 'Something went wrong: ' + err.message;
		res.end(textToSend);
	};

	Promise.resolve()
	.then(function() {
		var requestBody = req.body;

		var inputString = requestBody.text;
		if (!inputString)
			return Promise.reject(createError('Give me some command'));
		var splitted = inputString.split(' ');
		var commandType = splitted[0];
		if (commandType)
			commandType = commandType.toString().toLowerCase();
		
		if (commandType === 'add') {
			return doAddition(splitted, requestBody)
			.then(function() {
				res.end('Done');
			});
		}

		if (commandType === 'scores' || commandType === 'score') {
			return getScores(splitted, requestBody)
			.then(function(stringToSend) {
				res.end(stringToSend);
			});
		}

		return Promise.reject(createError('Command not supported'));
	})
	.catch(errorHandler);
});


function createError(message, options) {
	var toRet = new Error(message);
	toRet.isMine = true;
	for (var key in options)
		toRet[key] = options[key];
	return toRet;
}

// function getUsageHelp(commandName) {
// 	function createSample(target) {
// 		return commandName + ' *' + target + '* I know what you did last summer';
// 	}

// 	var text = 'Expected usage: \n' +
// 		commandName + ' help -- Displays help message.\n' +
// 		createSample('@user') + ' -- Sends to the specified user.\n' +
// 		createSample('#channel') + ' -- Sends to the specified public channel.\n' +
// 		createSample('group') + ' -- Sends to the specified private group.\n' +
// 		createSample(':here') + ' -- Sends to the current group/channel/DM where you type this command.';

// 	return text;
// }

// function getFullHelp(commandName) {
// 	var text =
// 		'Allows to send anonymous messages to users, channels and groups.\n' +
// 		'The most convenient and safe way is to open up a conversation with slackbot in Slack and type the commands there, so that nobody detects that you are typing and you don\'t accidentally reveal yourself by typing an invalid command.\n' +
// 		'Messages and authors are not stored, and the sources are available at <https://github.com/TargetProcess/slack-anonymous>.\n' +
// 		'\n' +
// 		getUsageHelp(commandName);

// 	return text;
// }

// function createResponsePayload(requestBody) {
// 	if (!requestBody) {
// 		return createError('Request is empty');
// 	}

// 	var text = requestBody.text;
// 	var command = requestBody.command;

// 	if (!text || text === 'help') {
// 		return createError(getFullHelp(command));
// 	}

// 	var splitted = text.split(" ");
// 	if (splitted.length <= 1) {
// 		return createError(getUsageHelp(command));
// 	}

// 	var target = splitted[0];
// 	var remainingText = splitted.slice(1).join(' ');
// 	remainingText = 'Someone said "' + remainingText + '"';

// 	if (target === ':here') {
// 		return {
// 			channel: requestBody.channel_id,
// 			text: remainingText
// 		};
// 	}

// 	return {
// 		channel: target,
// 		text: remainingText
// 	};
// }

// app.post('/', function(req, response) {
// 	var payloadOption = createResponsePayload(req.body);
// 	if (payloadOption.error) {
// 		response.end(payloadOption.error);
// 		return;
// 	}
// 	request({
// 		url: process.env.POSTBACK_URL,
// 		json: payloadOption,
// 		method: 'POST'
// 	}, function (error) {
// 		if(error) {
// 			response.end('Unable to post your anonymous message: ' + JSON.stringify(error));
// 		} else {
// 			response.end('Delivered! :cop:');
// 		}

// 	});
// });

app.get('/', function(request, response) {
	response.write('HELLO THERE');
	response.end();
});

app.listen(app.get('port'), function() {
	console.log('Node app is running on port', app.get('port'));
	MongoClient.connect('mongodb://localhost:27017/plusBot', function(err, db) {
		if (err) return console.log(err);
		app.db = db;
		console.log('Connected to mongo');
	});
});
