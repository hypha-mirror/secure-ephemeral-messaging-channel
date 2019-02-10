# @hypha/secure-ephemeral-messaging-channel

Adds a symmetrically-encrypted authenticated messaging channel between nodes for the same database ([hypercore](https://github.com/mafintosh/hypercore), [hyperdb](https://github.com/mafintosh/hyperdb), or [hyperdrive](https://github.com/mafintosh/hyperdrive)). Currently used in Hypha to provide a secure ephemeral messaging channel between nodes owned by the same person for the purpose of authorising new nodes.

Messages are encrypted using the `secretbox_easy` function from the _sodium-universal_ package. This currently uses the XSalsa20 stream cipher for encryption and a Poly1305 MAC for authentication.

This module is based on [dat-ephemeral-ext-msg](https://github.com/beakerbrowser/dat-ephemeral-ext-msg) by [Paul Frazee](https://pfrazee.hashbase.io/).

## Setup

If you update the _schema.proto_, you must run `npm run protobuf` to generate the _encodings.js_ file again. See [protocol-buffers](https://github.com/mafintosh/protocol-buffers) for more details.

## Spec

[A spec](spec.md) based on [Dep-0000](https://github.com/beakerbrowser/dat-ephemeral-ext-msg/blob/master/spec.md) is available. The spec has not been submitted to the Dat working group yet.

## Usage

```js
const { SecureEphemeralMessagingChannel } = require('@hypha/secure-ephemeral-messaging-channel')

// Create the channel, passing in the global signing secret key.
// (In Hypha, this is deterministically derived from the owner’s passphrase.)
const secureEphemeralMessagingChannel = new SecureEphemeralMessagingChannel(secretKey)

// Create a database (hypercore, hyperdb, or hyperdrive instance)
const db = hyperdb(filename => ram(filename))

//
// Create your event handlers.
//
secureEphemeralMessagingChannel.on('message', (database, peer, messageObject) => {
  // `peer` has sent `payload` of mimetype `contentType` for `database`
})

secureEphemeralMessagingChannel.on('received-bad-message', (err, database, peer) => {
  // there was an error parsing a received message
})


// Add the database to the ephemeral messaging channel.
secureEphemeralMessagingChannel.addDatabase(db)

// Register the ‘encrypted-ephemeral’ extension in your replication streams.
const webSwarm = swarm(signalhub(discoveryKey, ['https://localhost:444']))
webSwarm.on('peer', function (remoteWebStream) {

  // Create the local replication stream.
  const localReplicationStream = db.replicate({
    live: true,
    extensions: ['secure-ephemeral']
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
secureEphemeralMessagingChannel.hasSupport(database, peerId)
secureEphemeralMessagingChannel.broadcast(database, messageObject)
secureEphemeralMessagingChannel.send(database, peerId, messageObject)
```
