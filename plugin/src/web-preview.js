import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {extname} from 'node:path';
const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.pdf':'application/pdf','.mp3':'audio/mpeg','.mp4':'video/mp4'};
// Each connected project gets an isolated loopback origin. Never expose the MCP transport.
export function webPreviewService(workspace){
  const servers=new Map();
  return {
    async open(root,path){
      const target=await workspace.resolve(root,path);
      if(!/\.html?$/i.test(path) || !(await stat(target)).isFile())throw Error('Select a local HTML file.');
      let entry=servers.get(root);
      if(!entry){
        const token=randomBytes(24).toString('hex');
        const server=createServer(async(req,res)=>{
          res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','same-origin');
          try{
            if(req.headers.host!==`127.0.0.1:${server.address().port}`)throw Error('Invalid host');
            if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
            const url=new URL(req.url,'http://127.0.0.1');
            const prefix=`/${token}/`;
            if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
            const name=decodeURIComponent(url.pathname.slice(prefix.length));
            const file=await workspace.resolve(root,name),info=await stat(file);
            if(!info.isFile() || info.size>50*1024*1024)throw Error('Not a preview file');
            res.setHeader('Content-Type',types[extname(file).toLowerCase()] || 'application/octet-stream');
            res.end(req.method==='HEAD'?undefined:await readFile(file));
          }catch{res.writeHead(404);res.end('File unavailable');}
        });
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
        server.unref();entry={server,token};servers.set(root,entry);
      }
      return {url:`http://127.0.0.1:${entry.server.address().port}/${entry.token}/${path.split('/').map(encodeURIComponent).join('/')}`};
    },
    async close(){await Promise.all([...servers.values()].map(({server})=>new Promise(resolve=>server.close(resolve))));servers.clear();}
  };
}
