import {selectionPrompt} from './review-prompts.js';

export function annotationText(item){return selectionPrompt(item);}

// Each message draft append creates its own host-owned, independently removable
// attachment. Embedded resources keep prose out of the prompt input itself.
export function createReviewAttachment(extensions) {
  const staged=new Set();
  let queue=Promise.resolve();
  return {
    has:id=>staged.has(id),
    stage(item) {
      const run=queue.catch(()=>{}).then(async()=>{
        if(!extensions.message)throw new Error('This host cannot attach review context. Your note is saved locally.');
        const result=await extensions.message.send({role:'user',content:[{
          type:'resource',resource:{uri:`markdown-review://annotation/${encodeURIComponent(item.id)}/${encodeURIComponent(item.updatedAt || 'draft')}`,
            mimeType:'text/markdown',text:annotationText(item)}
        },...((item.pdf?.screenshot || item.html?.screenshot)?[{type:'image',mimeType:'image/jpeg',data:(item.pdf?.screenshot || item.html?.screenshot).split(',')[1]}]:[])],_meta:{'openai/message':{target:'active',send:false}}});
        if(result?.isError)throw new Error('The host rejected the review attachment.');
        staged.add(item.id);
      });
      queue=run;return run;
    }
  };
}

export async function requestExplanation(app,extensions,item,signal,onCreated=()=>{}) {
  if(!['short','medium','long'].includes(item.detail))throw new Error('Choose an explanation length first.');
  const created=await app.callServerTool({name:'generate_review_explanation',arguments:{annotation:item}},{signal,timeout:200000});
  const requestId=created.structuredContent?.requestId;
  if(created.isError || !requestId)throw new Error(created.content?.find(block=>block.type==='text')?.text || 'Could not generate the background explanation.');
  onCreated(requestId,created.structuredContent);
  return {route:'background',requestId,model:created.structuredContent?.model};
}
