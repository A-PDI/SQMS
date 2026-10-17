'use strict';
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), zlib=require('node:zlib');
const tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),'sqms-domain-test-'));
process.on('exit',()=>fs.rmSync(tmpDir,{recursive:true,force:true}));
function extractPdfPages(buffer) {
  const raw = buffer.toString('latin1');
  const pages = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = streamRe.exec(raw)) !== null) {
    let data = Buffer.from(match[1], 'latin1');
    try {
      data = zlib.inflateSync(data);
    } catch (_) {
      continue; // not a deflate stream (fonts, images…)
    }
    const content = data.toString('latin1');
    if (!content.includes('BT')) continue;
    const strings = [];
    const textRe = /BT([\s\S]*?)ET/g;
    let block;
    while ((block = textRe.exec(content)) !== null) {
      const hexes = block[1].match(/<([0-9a-fA-F]+)>/g) || [];
      const text = hexes
        .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
        .join('');
      if (text) strings.push(text);
    }
    if (strings.length) pages.push(strings);
  }
  return pages;
}

/** All text in the document, flattened. */
function extractPdfText(buffer) {
  return extractPdfPages(buffer).flat();
}


module.exports={tmpDir,extractPdfPages,extractPdfText};
