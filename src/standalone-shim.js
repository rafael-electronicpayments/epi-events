// Standalone replacement for the Claude artifact viewer's `window.claude.use('downloads')`.
// The prototype was first hosted as a claude.ai artifact, which injects window.claude.
// Outside that viewer this shim performs a normal browser download instead.
if(!window.claude){
  window.claude={use:async name=>{
    if(name!=='downloads')return null;
    return {save:async({filename,data})=>{
      const blob=new Blob([data]);
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      return {status:'saved'};
    }};
  }};
}
