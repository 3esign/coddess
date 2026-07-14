const regex = /(?:<tool\s+name\s*=\s*['"]?([a-z_]+)['"]?\s*>([\s\S]*?)(?:<\/tool>|(?=<tool|<final)|$))|(?:<final>([\s\S]*?)(?:<\/final>|(?=<tool|<final)|$))/gi;

const text = '<tool name="write_file">' + 'a'.repeat(250000);

console.log('start');
console.time('exec');
regex.exec(text);
console.timeEnd('exec');
