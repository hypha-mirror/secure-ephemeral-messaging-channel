# Secure Ephemeral Message Channel Specification

# Summary
[summary]: #summary

This spec defines the non-standard `secure-ephemeral` extension message used in the Dat replication protocol. This message provides a way to send arbitrary application data to a peer through an existing connection.


# Motivation
[motivation]: #motivation

While Dat is effective at sharing persistent datasets, applications frequently need to transmit extra information which does not need to persist. This kind of information is known as "ephemeral." Examples include: sending chat messages, proposing changes to a dat, alerting peers to events, broadcasting identity information, and sharing the URLs of related datasets.

This spec is based on the [Dep-0000 Ephemeral Message (Extension Message) spec](https://github.com/beakerbrowser/dat-ephemeral-ext-msg/blob/master/spec.md) which was motivated by the need for a quick solution to these use-cases. That spec establishes a mechanism for sending ephemeral messages over existing Dat connections. This spec diverges from Dep-0000 in three major ways:

1. It narrows the scope of recipients to nodes owned by the same person.
2. It reduces the schema to a nonce and an authenticated symmetrically-encrypted field.
3. Limits the plaintext message format to JSON.

# Reference Documentation
[reference-documentation]: #reference-documentation

This spec is implemented using the Dat replication protocol's "extension messages." In order to broadcast support for this spec, a client should declare the `'secure-ephemeral'` extension in the replication handshake.

Secure-ephemeral messages can be sent at any time after the connection is established by sending an extension message of type `'secure-ephemeral'`. The message payload is a protocol buffer with the following schema:

```
message SecureEphemeralMessage {
  required bytes nonce = 1;
  required bytes ciphertext = 2;
}
```

There is no dictated structure for the plaintext message.

The message is encrypted using the `secretbox_easy` function from the _sodium-universal_ package. This currently uses the XSalsa20 stream cipher for encryption and a Poly1305 MAC for authentication.

The client may respond to the message by emitting an event, so that it may be handled by the client's application logic. No acknowledgment of receipt is automatically provided (no "ACK").

# Privacy, security, and reliability
[privacy-security-and-reliability]: #privacy-security-and-reliability

The Dat messaging channel is encrypted using the public key of the first hypercore to be exchanged over the channel. As a result, all traffic can be decrypted and/or modified by an intermediary which possesses the public key. Secure ephemeral messages are further authenticated and encrypted with a secret key known to the owner of the original hypercore.

Applications should not assume connectivity will occur between all peers that have "joined the swarm" for a hypercore. There are many factors which may cause a peer not to connect: failed NAT traversal, the client running out of available sockets, or even the intentional blocking of a peer by the discovery network.


# Drawbacks
[drawbacks]: #drawbacks

- The approach and implementation of this spec should be reviewed by the community and by cryptographers.

# Changelog
[changelog]: #changelog

- 2019-02-10: Update to reflect changes in secure ephemeral message channel fork. Previous entries are for Dep-0000
- 2018-07-02: Add "Privacy, security, and reliability" section
- 2018-06-20: Add a size-limit suggestion
- 2018-06-10: Change the payload encoding to protobuf and provide a more flexible content-type field.
- 2018-06-10: Expand on the motivation of this spec
- 2018-06-10: Change the message identifier to `'ephemeral'`
- 2018-06-05: Added a header with 'encoding' values and increased the max payload size from 256b to 10kb.
- 2018-06-05: First complete draft submitted for review
