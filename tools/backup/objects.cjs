#!/usr/bin/env node
'use strict';
// Local, explicitly named test-bucket rehearsal. Production backup commands are in the release runbook.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');
const requireCore = createRequire(path.resolve(__dirname, '../../packages/server-core/package.json'));
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } = requireCore('@aws-sdk/client-s3');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  const { values: args } = parseArgs({ options: { mode: { type: 'string' }, directory: { type: 'string' }, bucket: { type: 'string' } } });
  if (!['backup','restore'].includes(args.mode) || !args.directory || !args.bucket) throw new Error('Use --mode backup|restore --directory NEW_PRIVATE_PATH --bucket EXPLICIT_TEST_BUCKET');
  const endpoint = new URL(process.env.S3_ENDPOINT || '');
  if (!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname) || !/-test(?:-files)?$/.test(args.bucket)) throw new Error('This rehearsal tool requires a loopback S3 endpoint and a named test bucket');
  const directory = path.resolve(args.directory);
  const client = new S3Client({ endpoint: endpoint.href, region: process.env.S3_REGION || 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
  const list = async bucket => { let token; const rows=[]; do { const r=await client.send(new ListObjectsV2Command({ Bucket:bucket, ContinuationToken:token })); rows.push(...(r.Contents || [])); token=r.NextContinuationToken; } while(token); return rows; };
  const bytes = async (bucket,key) => { const r=await client.send(new GetObjectCommand({ Bucket:bucket,Key:key })); return Buffer.from(await r.Body.transformToByteArray()); };
  try {
    if (args.mode === 'backup') {
      await fs.mkdir(directory, { mode: 0o700 }); // No recursive mkdir or overwrite of an existing baseline.
      const entries=[];
      for(const [index,entry] of (await list(args.bucket)).entries()) {
        const body=await bytes(args.bucket,entry.Key); const file=String(index).padStart(8,'0');
        await fs.writeFile(path.join(directory,file),body,{flag:'wx',mode:0o600}); entries.push({key:entry.Key,file,size:body.length,sha256:sha(body)});
      }
      await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({ formatVersion:1,endpoint:endpoint.origin,bucket:args.bucket,createdAt:new Date().toISOString(),entries },null,2)+'\n',{flag:'wx',mode:0o600});
      console.log(JSON.stringify({ mode:'backup',bucket:args.bucket,objects:entries.length,bytes:entries.reduce((n,e)=>n+e.size,0) }));
    } else {
      const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
      const sourceEndpoint=new URL(manifest.endpoint);
      if(manifest.formatVersion!==1 || !['127.0.0.1','localhost','[::1]'].includes(sourceEndpoint.hostname) || !/-test(?:-files)?$/.test(manifest.bucket) || (manifest.bucket===args.bucket && sourceEndpoint.origin===endpoint.origin))throw new Error('Restore must use a different empty local test destination');
      // Validate the complete archive before touching the restore destination.
      for(const e of manifest.entries){ if(!/^\d{8}$/.test(e.file))throw new Error('Invalid archive path'); const body=await fs.readFile(path.join(directory,e.file)); if(body.length!==e.size || sha(body)!==e.sha256)throw new Error('Backup byte/hash mismatch'); }
      try { await client.send(new HeadBucketCommand({Bucket:args.bucket})); } catch(e){ if(e.$metadata?.httpStatusCode!==404)throw e; await client.send(new CreateBucketCommand({Bucket:args.bucket})); }
      if((await list(args.bucket)).length)throw new Error('Restore target is not empty; use another disposable bucket');
      for(const e of manifest.entries){ const body=await fs.readFile(path.join(directory,e.file)); await client.send(new PutObjectCommand({Bucket:args.bucket,Key:e.key,Body:body,ContentLength:body.length})); if(sha(await bytes(args.bucket,e.key))!==e.sha256)throw new Error('Restored object does not match backup'); }
      console.log(JSON.stringify({mode:'restore',bucket:args.bucket,objects:manifest.entries.length,hashesVerified:true}));
    }
  } finally { client.destroy(); }
}
main().catch(e=>{ console.error(e.message?.startsWith('Use ') || /rehearsal|Restore|Backup|Invalid archive/.test(e.message || '') ? e.message : 'Backup/restore failed; inspect private local resources. No credentials were logged.'); process.exitCode=1; });
