import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  // GET: /api/cache?hash=xxx
  if (req.method === 'GET') {
    const hash = req.query.hash;
    if (!hash) {
      return res.status(400).json({ error: 'Missing hash parameter' });
    }

    try {
      const { blobs } = await list({ prefix: `cache/${hash}.json` });
      
      if (blobs.length > 0) {
        // Blob found, fetch its content
        const blobUrl = blobs[0].url;
        const response = await fetch(blobUrl);
        const data = await response.json();
        return res.status(200).json(data);
      } else {
        return res.status(404).json({ error: 'Cache not found' });
      }
    } catch (error) {
      console.error('[API] GET Cache Error:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // POST: /api/cache
  if (req.method === 'POST') {
    const { hash, data } = req.body;
    if (!hash || !data) {
      return res.status(400).json({ error: 'Missing hash or data in body' });
    }

    try {
      // Put file to Vercel Blob without random suffix for predictable listing
      const blob = await put(`cache/${hash}.json`, JSON.stringify(data), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json'
      });
      return res.status(200).json(blob);
    } catch (error) {
      console.error('[API] POST Cache Error:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
