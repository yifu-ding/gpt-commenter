import {insertNewlineContinueMarkupCommand} from '@codemirror/lang-markdown';
const continueMarkup=insertNewlineContinueMarkupCommand({nonTightLists:false});
// Preserve list numbering/indentation, but do not inherit loose-list blank lines.
export function markdownEnter(view){
 if(view.state.readOnly)return false;
 const state=view.state;
 return continueMarkup({state,dispatch(transaction){
  const corrections=[];
  transaction.changes.iterChanges((_from,_to,from,_end,insert)=>{
   const extra=/^\n[ \t>]*\n/.exec(insert.toString());
   if(extra)corrections.push({from,to:from+extra[0].length-1});
  });
  // Exiting an empty list item still advances by one physical line.
  if(transaction.newDoc.lines===state.doc.lines && transaction.selection.ranges.length===1){
   const at=transaction.selection.main.head;corrections.push({from:at,insert:'\n'});
  }
  if(!corrections.length){view.dispatch(transaction);return;}
  const change=transaction.state.changes(corrections);
  view.dispatch(state.update({changes:transaction.changes.compose(change),selection:transaction.newSelection.map(change),scrollIntoView:true,userEvent:'input'}));
 }});
}
