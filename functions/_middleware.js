// www.mindlap.in serves the same site as mindlap.in; send it to the one address Google should index.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === 'www.mindlap.in') {
    url.hostname = 'mindlap.in';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
