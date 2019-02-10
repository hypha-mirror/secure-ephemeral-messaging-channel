// Common tests that are run once for
// hypercore, hyperdb, and hyperdrive.

var tape = require('tape')
var ram = require('random-access-memory')
var { EphemeralMessagingChannel } = require('../../')

module.exports = function (database) {

  var isHypercore = database.name === 'Feed'
  var isHyperDB = database.name === 'HyperDB'
  var isHyperdrive = database.name === 'Hyperdrive'

  var databaseNames = {Feed: 'hypercore', HyperDB: 'hyperdb', Hyperdrive: 'hyperdrive'}
  var databaseName = databaseNames[database.name]

  const secretKey = Buffer.from('2e4d36dc3c49049b450a3656188692a328df4b9cff11b6d95157fc21363a1b28', 'hex')

  tape(`exchange ephemeral messages: ${databaseName}`, function (t) {

    // must use 2 instances to represent 2 different nodes
    var srcEphemeral = new EphemeralMessagingChannel(secretKey)
    var cloneEphemeral = new EphemeralMessagingChannel(secretKey)

    var src = database(ram)
    var clone
    var cloneFeed

    var self = this

    // Isomorphic interface to support hypercore, hyperdb, and hyperdrive.
    // The three packages have slightly different APIs that makes this necessary.
    // TODO: open issue for unifying the interfaces.
    var srcFeed = src.source || src.metadata || src
    var putFunction = isHyperdrive ? 'writeFile' : isHyperDB ? 'put' : 'append'

    function firstCallback (err) {
      t.error(err, 'no error')
      src[putFunction].apply(src, secondArgs)
    }

    function secondCallback (err) {
      t.error(err, 'no error')
      src[putFunction].apply(src, thirdArgs)
    }

    function thirdCallback (err) {
      t.error(err, 'no error')
      if (isHyperdrive) {
        t.same(src.version, 3, 'version correct')
      }

      // generate clone instance
      clone = database(ram, src.key)
      cloneFeed = clone.source || clone.metadata || clone
      clone.on('ready', startReplication)
    }

    var firstArgs = (isHyperdrive || isHyperDB) ? ['/first.txt', 'number 1', firstCallback] : ['first', firstCallback]
    var secondArgs = (isHyperdrive || isHyperDB) ? ['/second.txt', 'number 2', secondCallback] : ['second', secondCallback]
    var thirdArgs = (isHyperdrive || isHyperDB) ? ['/third.txt', 'number 3', thirdCallback] : ['first', thirdCallback]

    src.on('ready', function () {
      // generate source archive
      t.ok(srcFeed.writable)

      src[putFunction].apply(src, firstArgs)
    })

    function startReplication () {
      // wire up archives
      srcEphemeral.addDatabase(src)
      cloneEphemeral.addDatabase(clone)

      // listen to events
      var messageEventCount1 = 0
      srcEphemeral.on('message', onMessage1)
      cloneEphemeral.on('message', onMessage1)
      function onMessage1 (archive, peer, msg) {
        if (archive === src) {
          // received clone's data
          t.same(JSON.stringify(msg), '{"test":"bar"}', 'received clone data')
        }
        if (archive === clone) {
          // received src's data
          t.same(JSON.stringify(msg), '{"test":"foo"}', 'received src data')
        }
        if (++messageEventCount1 === 2) {
          hasReceivedEvents1()
        }
      }

      // start replication
      var stream1 = clone.replicate({
        id: Buffer.from('clone-stream'),
        live: true,
        extensions: ['encrypted-ephemeral']
      })
      var stream2 = src.replicate({
        id: Buffer.from('src-stream'),
        live: true,
        extensions: ['encrypted-ephemeral']
      })
      stream1.pipe(stream2).pipe(stream1)

      // wait for handshakes
      var handshakeCount = 0
      stream1.on('handshake', gotHandshake)
      stream2.on('handshake', gotHandshake)

      function gotHandshake () {
        if (++handshakeCount !== 2) return

        // We need to do this on the next tick to give clone’s peers a chance to populate.
        process.nextTick(() => {
          // has support
          t.ok(srcEphemeral.hasSupport(src, srcFeed.peers[0]), 'src has support')
          t.ok(cloneEphemeral.hasSupport(clone, cloneFeed.peers[0]), 'clone has support')

          // send values
          srcEphemeral.send(src, srcFeed.peers[0], {test:'foo'})
          cloneEphemeral.send(clone, cloneFeed.peers[0], {test: 'bar'})
        })
      }

      function hasReceivedEvents1 () {
        srcEphemeral.removeListener('message', onMessage1)
        cloneEphemeral.removeListener('message', onMessage1)

        // listen to new events
        var messageEventCount2 = 0
        srcEphemeral.on('message', onMessageEvent2)
        cloneEphemeral.on('message', onMessageEvent2)
        function onMessageEvent2 (archive, peer, msg) {
          if (archive === src) {
            // received clone's data
            t.ok(msg.someOtherIntegers.equals(Buffer.from([4,3,2,1])), 'received clone data')
          }
          if (archive === clone) {
            // received src's data
            t.ok(msg.someIntegers.equals(Buffer.from([1,2,3,4])), 'received src data')
          }
          if (++messageEventCount2 === 2) {
            hasReceivedEvents2()
          }
        }

        // broadcast new values
        srcEphemeral.broadcast(src, {someIntegers: Buffer.from([1,2,3,4])})
        cloneEphemeral.broadcast(clone, {someOtherIntegers: Buffer.from([4,3,2,1])})
      }

      function hasReceivedEvents2 () {
        // unwatch
        srcEphemeral.removeDatabase(src)
        cloneEphemeral.removeDatabase(clone)

        t.end()
      }
    }
  })

  tape(`no peers causes no issue: ${databaseName}`, function (t) {
    var ephemeral = new EphemeralMessagingChannel(secretKey)

    var src = database(ram)
    src.on('ready', function () {
      ephemeral.addDatabase(src)
      ephemeral.broadcast(src, {thisIsA: '"test"'})
      t.pass('no error thrown')
      t.end()
    })
  })

  tape(`fires received-bad-message: ${databaseName}`, function (t) {
    // must use 2 instances to represent 2 different nodes
    var srcEphemeral = new EphemeralMessagingChannel(secretKey)
    var cloneEphemeral = new EphemeralMessagingChannel(secretKey)

    var src = database(ram)
    var srcFeed = src.source || src.metadata || src
    var clone
    var cloneFeed
    src.on('ready', function () {
      // generate clone instance
      clone = database(ram, src.key)
      cloneFeed = clone.source || clone.metadata || clone
      clone.on('ready', startReplication)
    })

    function startReplication () {
      // wire up archives
      srcEphemeral.addDatabase(src)
      cloneEphemeral.addDatabase(clone)

      // listen to events
      cloneEphemeral.on('received-bad-message', err => {
        t.ok(err instanceof Error, 'error was emitted')
        t.end()
      })

      // start replication
      var stream1 = clone.replicate({
        id: Buffer.from('clone-stream'),
        live: true,
        extensions: ['encrypted-ephemeral']
      })
      var stream2 = src.replicate({
        id: Buffer.from('src-stream'),
        live: true,
        extensions: ['encrypted-ephemeral']
      })
      stream1.pipe(stream2).pipe(stream1)

      // wait for handshakes
      var handshakeCount = 0
      stream1.on('handshake', gotHandshake)
      stream2.on('handshake', gotHandshake)

      function gotHandshake () {
        if (++handshakeCount !== 2) return

        // We need to do this on the next tick to give clone’s peers a chance to populate.
        process.nextTick(() => {
          // has support
          t.ok(srcEphemeral.hasSupport(src, srcFeed.peers[0]), 'src has support')
          t.ok(cloneEphemeral.hasSupport(clone, cloneFeed.peers[0]), 'clone has support')

          // send bad message
          srcFeed.peers[0].stream.extension('encrypted-ephemeral', Buffer.from([0,1,2,3]))
        })
      }
    }
  })
}
