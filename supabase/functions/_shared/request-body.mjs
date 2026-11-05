// Enforce byte limits while reading, even without Content-Length.
export async function readLimitedBody(request, maxBytes) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new RangeError('Request too large');
  if (!request.body) return '';

  const reader=request.body.getReader(), decoder = new TextDecoder();

  let size=0, text='';
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done)
        break;

      size+=value.byteLength;
      if (size>maxBytes) {
        await reader.cancel();
        throw new RangeError('Request too large');
      }
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  } finally { reader.releaseLock(); }
}