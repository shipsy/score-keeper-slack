var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var request = require('request');
var MongoClient = require('mongodb').MongoClient;
var https = require('https');
var http = require('http');
var moment = require('moment');
var csvStringify = require('csv-stringify');
global.Promise = require('bluebird');

var server = null;
var usessl = false;
if (process.env.SSL === 'true')
	usessl = true;

if (usessl) {
	var sslConfig = require('./ssl-config.js');
	server = https.createServer({
		key: sslConfig.privateKey,
		cert: sslConfig.certificate
	},app);
}
else {
	server = http.createServer(app);
}

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
			// $inc: {
			// 	['scores.' + thingName]: change
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
	})
	.then(function() {
		return app.db.collection('scores').update(
			{
				groupName: groupName,
				thingName: thingName
			},
			{
				$inc: {
					score: change
				}
			},
			{upsert: true}
		);
	})
};

function getTransactions(splitted, requestBody, req, res) {
	var groupName = splitted[1];
	if (!groupName)
		return Promise.reject(createError('Group name should be present'));
	groupName = groupName.toLowerCase();

	return app.db.collection('scoreHistory').find({groupName: groupName})
		.sort({createdAt: -1})
		.limit(20)
		.toArray()
	.then(function(transactions) {
		var textToSend = '';
		if (transactions.length === 0) {
			textToSend = 'No transactions found';
			return res.end(textToSend);
		}

		textToSend = 'LATEST TRANSACTIONS:\n'
		textToSend += transactions
		.map(function(elem) {
			var toRet = elem.change.toString() + ' for ' + elem.thingName + ' by ' + 
				elem.createdByName + ' on ';
			var createdAtString = 'unknown';
			if (elem.createdAt) {
				createdAtString = moment(elem.createdAt).format('DD-MMM-YY HH:mm');
			}
			toRet += createdAtString;
			return toRet;
		})
		.join('\n');

		textToSend += '\n' + '<https://example.com/transactions/transactions_' + groupName + '.csv?group=' +
			groupName + '|Download CSV>';

		res.end(textToSend);
	});
};

function getTransactionsCSV(req, res) {
	var query = req.query;
	var groupName = query.group;
	if (!groupName)
		return Promise.reject(createError('Group name should be present'));
	groupName = groupName.toLowerCase();

	return app.db.collection('scoreHistory').find({groupName: groupName})
		.sort({createdAt: -1})
		.toArray()
	.then(function(transactions) {
		if (transactions.length === 0)
			return Promise.reject(createError('No transactions found'));

		var stringifier = csvStringify({header: true});
		res.setHeader('Content-disposition', 'attachment');
		res.set('Content-Type', 'text/csv');
		res.status(200);

		//Pipe stringifier to response
		stringifier.pipe(res);

		stringifier.on('error', function(err) {
			return cb(err);
		});
		console.log('here 1')

		//For async
		return Promise.mapSeries(transactions, function(elem) {
			var toSend = {
				'thing': elem.thingName,
				'change': elem.change,
				'createdBy': elem.createdByName,
				'createdAt': moment(elem.createdAt).format('YYYY-MM-DD HH:mm:ss')
			};
			stringifier.write(toSend);
		})
		.then(function() {
			stringifier.end();
		});
	})
	.catch(function(err) {
		console.log(err);
		if (err.isMine)
			res.status(400);
		else
			res.status(500);

		res.json({error: err.message});
	});
}


function getScores(splitted, requestBody, req, res) {
	var groupName = splitted[1];
	if (!groupName)
		return Promise.reject(createError('Group name should be present'));
	groupName = groupName.toLowerCase();

	return app.db.collection('scores').find(
		{
			groupName: groupName
		}
	)
	.toArray()
	.then(function(result) {
		// var scoreList = Object.keys(result.scores)
			// .map((key) => {return {name: key, score: result.scores[key]}})
		var scoreList = result
			.map((elem) => {return {name: elem.thingName, score: elem.score}})
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

		if (commandType === 'transactions' || commandType === 'transaction') {
			return getTransactions(splitted, requestBody, req, res);
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

app.get('/', function(request, response) {
	response.write('HELLO THERE');
	response.end();
});

app.get('/transactions/:fileName', function(req, res) {
	getTransactionsCSV(req, res);
});

server.listen(app.get('port'), function() {
	console.log('Node app is running on port', app.get('port'));
	MongoClient.connect('mongodb://localhost:27017/plusBot', function(err, db) {
		if (err) return console.log(err);
		app.db = db;
		console.log('Connected to mongo');
	});
});
