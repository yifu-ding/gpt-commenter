export const isMarkdown=path=>/\.(md|markdown)$/i.test(path);
const imageTypes={png:'image/png',apng:'image/apng',jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',ico:'image/x-icon',avif:'image/avif',svg:'image/svg+xml'};
export const imageMime=path=>imageTypes[path.split('.').at(-1).toLowerCase()] || null;
export const isImage=path=>!!imageMime(path);
export const isDocx=path=>/\.docx$/i.test(path);
export const isOfficeTemporary=path=>/^(?:~\$|\.~)/.test(path.split(/[\\/]/).at(-1)) && /\.(?:doc[xm]?|dot[xm]?|xls[xmb]?|ppt[xm]?|rtf|od[tsp])$/i.test(path);
export const isSupportedText=path=>!isImage(path) && !isPdf(path) && !isDocx(path);

export const isPdf=path=>/\.pdf$/i.test(path);
export const isLatex=path=>/\.tex$/i.test(path);
export const isSupportedFile=()=>true;
