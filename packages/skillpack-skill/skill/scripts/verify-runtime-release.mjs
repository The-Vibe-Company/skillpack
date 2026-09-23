import { verify, createPublicKey } from 'node:crypto';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 262144) process.exit(1);
}
try {
  const { manifest, signature, publicKey } = JSON.parse(input);
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(manifest, 'base64'), key, Buffer.from(signature, 'base64'))) process.exit(1);
} catch {
  process.exit(1);
}
