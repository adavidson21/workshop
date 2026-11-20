// `workshop secret`: saves and removes secrets in the operating system's own store (docs/security.md, Secrets).
// The code lives in agent/lib/secret-write.mjs, because Settings, Tokens & sign-ins saves and removes them too.
// The value never goes on a command line, in shell history, in a file Workshop writes or in a log.
export { compactKeyFile, looksLikeToken, passwordProblem, removeCommand, removeSecret, saveCommand, saveSecret, secretProblem, writeIndexEntry } from '../../agent/lib/secret-write.mjs';
