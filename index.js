const EventEmitter = require('events')
const encodings = require('./encodings')
const sodium = require('sodium-universal')

// exported api
// =

class SecureEphemeralMessagingChannel extends EventEmitter {
  constructor (secretKey) {
    super()
    this.secretKey = secretKey
    this.databaseWatchers = {}
  }

  getWatcher (database) {
    var key = toStr(database.key)
    return {key, watcher: this.databaseWatchers[key]}
  }

  addDatabase (database) {
    var {key, watcher} = this.getWatcher(database)
    if (!watcher) {
      watcher = this.databaseWatchers[key] = new DatabaseWatcher(database, this, this.secretKey)
      watcher.listen()
    }
  }

  removeDatabase (database) {
    var {key, watcher} = this.getWatcher(database)
    if (watcher) {
      watcher.unlisten()
      delete this.databaseWatchers[key]
    }
  }

  // does the given peer have protocol support?
  hasSupport (database, remoteId) {
    var {watcher} = this.getWatcher(database)
    if (watcher) {
      var peer = watcher.getPeer(remoteId)
      if (peer) {
        return remoteSupports(peer, 'secure-ephemeral')
      }
    }
    return false
  }

  // send a message to a peer
  send (database, remoteId, message) {

    // Check that this node can send messages.
    if (this.secretKey === undefined) {
      throw new Error('Unprivileged nodes cannot send messages.')
    }

    var {watcher} = this.getWatcher(database)
    if (watcher) {
      return watcher.send(remoteId, message)
    }
  }

  // send a message to all peers
  broadcast (database, message) {

    // Check that this node can broadcast messages.
    if (this.secretKey === undefined) {
      throw new Error('Unprivileged nodes cannot broadcast messages.')
    }

    var {watcher} = this.getWatcher(database)
    if (watcher) {
      return watcher.broadcast(message)
    }
  }
}
exports.SecureEphemeralMessagingChannel = SecureEphemeralMessagingChannel

// Private.

// Helper class to track individual databases.
class DatabaseWatcher {
  constructor (database, emitter, secretKey) {
    this.database = database
    this.emitter = emitter
    this.secretKey = secretKey

    this.onPeerAdd = this.onPeerAdd.bind(this)
    this.onPeerRemove = this.onPeerRemove.bind(this)
  }

  send (remoteId, message = {}, serialise = true) {
    // Get peer and assure support exists for the protocol extension.
    var peer = this.getPeer(remoteId)
    if (!remoteSupports(peer, 'secure-ephemeral')) {
      return
    }

    message = serialise ? _serialise(message, this.secretKey) : message

    getPeerFeedStream(peer).extension('secure-ephemeral', message)
  }

  broadcast (message, serialise = true) {
    // Send to all peers.
    var peers = this.hypercore.peers
    for (let i = 0; i < peers.length; i++) {
      this.send(peers[i], message, serialise)
    }
  }

  listen () {
    this.hypercore.on('peer-add', this.onPeerAdd)
    this.hypercore.on('peer-remove', this.onPeerRemove)
  }

  unlisten () {
    this.hypercore.removeListener('peer-add', this.onPeerAdd)
    this.hypercore.removeListener('peer-remove', this.onPeerRemove)
  }

  get hypercore () {
    // Return the actual hypercore to use based on whether
    // the database is a hypercore, hyperdb, or hyperdrive.
    if (this.database.metadata) {
      return this.database.metadata
    } else if (this.database.source) {
      return this.database.source
    } else {
      return this.database
    }
  }

  getPeer (remoteId) {
    remoteId = toRemoteId(remoteId)
    return this.hypercore.peers.find(p => isSameId(remoteId, toRemoteId(p)))
  }

  onPeerAdd (peer) {
    getPeerFeedStream(peer).on('extension', (type, codedMessage) => {
      // handle ephemeral messages only
      if (type !== 'secure-ephemeral') return

      if (this.secretKey === undefined) {
        // This is an unprivileged node. It cannot decrypt received messages
        // as it does not have the secret key. Instead, it should act as a
        // relay and re-broadcast received messages to other nodes.

        // Decode the message using protocol buffers and emit a relay message.
        // Useful for debugging. We can disable this in production to reduce load.
        const decodedMessage = encodings.SecureEphemeralMessage.decode(codedMessage)
        this.emitter.emit('relay', decodedMessage)

        this.broadcast(codedMessage, /* serialise = */ false)
        return
      }

      try {
        // Decode the message using protocol buffers.
        const decodedMessage = encodings.SecureEphemeralMessage.decode(codedMessage)
        const nonce = decodedMessage.nonce
        const ciphertext = decodedMessage.ciphertext

        if (nonce.length !== sodium.crypto_secretbox_NONCEBYTES) {
          throw new Error('Incorrect nonce length.')
        }

        // Decrypt the message using the secret key.
        const message = Buffer.alloc(ciphertext.length - sodium.crypto_secretbox_MACBYTES)
        sodium.crypto_secretbox_open_easy(message, ciphertext, nonce, this.secretKey)

        // We expect JSON, parse it.
        const messageInUtf8 = message.toString('utf-8')

        // We use a reviver function so that any buffers that might have been included in the
        // JSON are correctly deserialised. (Courtesy: https://stackoverflow.com/a/34557997)
        const parsedMessage = JSON.parse(messageInUtf8, (k, v) => {
          if (
            v !== null            &&
            typeof v === 'object' &&
            'type' in v           &&
            v.type === 'Buffer'   &&
            'data' in v           &&
            Array.isArray(v.data)) {
            return Buffer.from(v.data)
          }
          return v;
        })

        // emit
        this.emitter.emit('message', this.database, peer, parsedMessage)
      } catch (error) {
        // TODO: Improve this: we should return different errors based on specifics
        // e.g., decryption failed, etc.
        this.emitter.emit('received-bad-message', error, this.database, peer/*, message*/)
      }
    })
  }

  onPeerRemove (peer) {
    // TODO needed?
  }
}

function _serialise (message, secretKey) {
  // Message should be an object
  if (typeof message !== 'object') {
    throw new Error('Message must be an object.')
  }

  const serialisedMessage = Buffer.from(JSON.stringify(message), 'utf-8')
  const ciphertext = Buffer.alloc(serialisedMessage.length + sodium.crypto_secretbox_MACBYTES)
  const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES)

  sodium.randombytes_buf(nonce)
  sodium.crypto_secretbox_easy(ciphertext, serialisedMessage, nonce, secretKey)

  const messageToEncode = {
    nonce,
    ciphertext
  }

  // Encode using protocol buffers.
  return encodings.SecureEphemeralMessage.encode(messageToEncode)
}

function getPeerFeedStream (peer) {
  if (!peer) return null
  return peer.stream
}

function getPeerProtocolStream (peer) {
  var feedStream = getPeerFeedStream(peer)
  if (!feedStream) return null
  return feedStream.stream
}

function getPeerRemoteId (peer) {
  var protocolStream = getPeerProtocolStream(peer)
  if (!protocolStream) return null
  return protocolStream.remoteId
}

function remoteSupports (peer, ext) {
  var protocolStream = getPeerProtocolStream(peer)
  if (!protocolStream) return false
  return protocolStream.remoteSupports(ext)
}

function toRemoteId (peer) {
  if (peer && typeof peer === 'object') {
    return getPeerRemoteId(peer)
  }
  return peer
}

function toStr (buf) {
  if (!buf) return buf
  if (Buffer.isBuffer(buf)) return buf.toString('hex')
  return buf
}

function isSameId (a, b) {
  if (!a || !b) return false
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) {
    return a.equals(b)
  }
  return toStr(a) === toStr(b)
}
