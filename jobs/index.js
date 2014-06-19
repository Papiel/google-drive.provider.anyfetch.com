"use strict";

var autoload = require('auto-load');
var kue = require('kue');
var async = require('async');
var rarity = require('rarity');
var debug = require('debug')('kue:boot');
var processors = autoload(__dirname);

module.exports = function(app) {
  var queue = app.get('queue');
  var store = app.get('keyValueStore');

  delete processors.index;
  for(var processor in processors) {
    debug('wait for job type', processor);
    // create new job processor
    queue.process(processor, app.get('concurrency'), processors[processor](app));
  }


  process.once('SIGTERM', function() {
    queue.shutdown(function() {
      process.exit(0);
    }, 5000 );
  });

  queue.on('job complete', function(id, result) {
    async.waterfall([
      function getJob(cb) {
        kue.Job.get(id, cb);
      },
      function removeJob(job, cb) {
        job.remove(rarity.carry([job], cb));
      },
      function setCursor(job, cb) {
        if(job.type === 'update') {
          async.waterfall([
            function setCursor(cb) {
              store.hset('cursor', job.data.anyfetchToken, result, cb);
            },
            function setLastUpdate(status, cb) {
              store.hset('lastUpdate', job.data.anyfetchToken, Date.now().toString(), cb);
            },
            function unlockUpdate(status, cb) {
              store.hdel('status', job.data.anyfetchToken, cb);
            }
          ], cb);
        } else {
          cb();
        }
      },
    ], function throwErrs(err) {
      if(err) {
        throw err;
      }
    });
  });
};
