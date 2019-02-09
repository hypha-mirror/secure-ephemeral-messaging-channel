# @hypha/ephemeral-messaging-channel

__WIP: DO NOT USE__

Adds a symmetrically-encrypted and authenticated messaging channel between nodes for the same database (hypercore, hyperdb, or hyperdrive). Currently used in Hypha to provide a secure ephemeral messaging channel between nodes owned by the same person for the purpose of authorising new nodes.

Based on from [dat-ephemeral-ext-msg](https://github.com/beakerbrowser/dat-ephemeral-ext-msg) by [Paul Frazee](https://pfrazee.hashbase.io/).

```js
const { EphemeralMessagingChannel } = require('@hypha/ephemeral-messaging-channel')

// Create the channel, passing in the global signing secret key.
// (The channel will derive a separate secret key from it to use for symetric encryption.)
const ephemeralMessagingChannel = new EphemeralMessagingChannel(secretKey)

// Create a database (hypercore, hyperdb, or hyperdrive instance)
const db = hyperdb(filename => ram(filename))

//
// Create your event handlers.
//
ephemeralMessagingChannel.on('message', (database, peer, messageObject) => {
  // `peer` has sent `payload` of mimetype `contentType` for `database`
})

ephemeralMessagingChannel.on('received-bad-message', (err, database, peer, messageBuffer) => {
  // there was an error parsing a received message
})


// Add the database to the ephemeral messaging channel.
ephemeralMessagingChannel.addDatabase(db)

// Register the ‘encrypted-ephemeral’ extension in your replication streams.
const webSwarm = swarm(signalhub(discoveryKey, ['https://localhost:444']))
webSwarm.on('peer', function (remoteWebStream) {

  // Create the local replication stream.
  const localReplicationStream = db.replicate({
    live: true,
    extensions: ['encrypted-ephemeral']
  })

  // Start replicating.
  pump(
    remoteWebStream,
    localReplicationStream,
    remoteWebStream,
    (error) => {
      console.log(`[WebRTC] Pipe closed for ${model.keys.nodeReadKeyInHex}`, error && error.message)
    }
  )
})

// Use the API
datEphemeralExtMsg.hasSupport(database, peerId)
datEphemeralExtMsg.broadcast(database, messageObject)
datEphemeralExtMsg.send(database, peerId, messageObject)
```
