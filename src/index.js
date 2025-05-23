// Cloudflare Worker RSS Feed Server with D1 Database

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Initialize database tables if they don't exist
      await initializeDatabase(env.DB);

      // Route handling
      if (path === '/feed.xml' || path === '/rss.xml' || path === '/feed') {
        return await generateRSSFeedHandler(request, env.DB);
      }
      
      if (path === '/feed.json' || path === '/json') {
        return await generateJSONFeedHandler(request, env.DB, corsHeaders);
      }
      
      if (path === '/items' && method === 'GET') {
        return await getItemsHandler(request, env.DB, corsHeaders);
      }
      
      if (path === '/items' && method === 'POST') {
        return await addItemHandler(request, env.DB, env.BROADCAST_TOKEN, corsHeaders);
      }
      
      if (path.startsWith('/items/') && method === 'PUT') {
        const itemId = path.split('/')[2];
        return await updateItemHandler(itemId, request, env.DB, env.BROADCAST_TOKEN, corsHeaders);
      }
      
      if (path.startsWith('/items/') && method === 'DELETE') {
        const itemId = path.split('/')[2];
        return await deleteItemHandler(itemId, request, env.DB, env.BROADCAST_TOKEN, corsHeaders);
      }
      
      if (path === '/broadcast' && method === 'POST') {
        return await broadcastHandler(request, env.DB, env.BROADCAST_TOKEN, corsHeaders);
      }
      
      if (path === '/settings' && method === 'GET') {
        return await getSettingsHandler(env.DB, corsHeaders);
      }
      
      if (path === '/settings' && method === 'POST') {
        return await updateSettingsHandler(request, env.DB, env.BROADCAST_TOKEN, corsHeaders);
      }

      // Default route - show available endpoints
      if (path === '/' || path === '') {
        return new Response(getAPIDocumentation(), {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      return new Response('Not Found', { status: 404, headers: corsHeaders });
      
    } catch (error) {
      console.error('Error:', error);
      return new Response(`Error: ${error.message}`, { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  },
};

// Initialize database tables
async function initializeDatabase(db) {
  // Feed settings table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS feed_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      title TEXT DEFAULT 'PolySend Notifications',
      description TEXT DEFAULT 'Latest updates and notifications from PolySend',
      link TEXT DEFAULT 'https://polysend.io',
      language TEXT DEFAULT 'en',
      copyright TEXT DEFAULT '',
      managing_editor TEXT DEFAULT '',
      webmaster TEXT DEFAULT '',
      generator TEXT DEFAULT 'PolySend RSS Service',
      image_url TEXT DEFAULT '',
      image_title TEXT DEFAULT '',
      image_link TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Feed items table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS feed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT,
      link TEXT,
      author TEXT,
      category TEXT,
      guid TEXT UNIQUE,
      pub_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Create indexes
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_feed_items_pub_date ON feed_items(pub_date DESC)
  `).run();
  
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_feed_items_published ON feed_items(published)
  `).run();

  // Insert default settings if none exist
  const settings = await db.prepare('SELECT id FROM feed_settings WHERE id = 1').first();
  if (!settings) {
    await db.prepare(`
      INSERT INTO feed_settings (id, title, description, link, generator)
      VALUES (1, 'PolySend Notifications', 'Latest updates and notifications from PolySend', 'https://polysend.io', 'PolySend RSS Service')
    `).run();
  }
}

// Generate RSS XML feed
async function generateRSSFeedHandler(request, db) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const category = url.searchParams.get('category');
  
  // Get feed settings
  const settings = await db.prepare('SELECT * FROM feed_settings WHERE id = 1').first();
  
  // Get feed items with proper parameter binding
  let query = `
    SELECT * FROM feed_items 
    WHERE published = 1
  `;
  let params = [];
  
  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  
  query += ` ORDER BY pub_date DESC LIMIT ?`;
  params.push(limit);
  
  const stmt = params.length > 0 ? db.prepare(query).bind(...params) : db.prepare(query).bind(limit);
  const { results: items } = await stmt.all();
  
  // Generate RSS XML
  const rssXml = generateRSSXML(settings, items, request.url);
  
  return new Response(rssXml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300', // 5 minutes cache
    }
  });
}

// Generate JSON feed
async function generateJSONFeedHandler(request, db, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const category = url.searchParams.get('category');
  
  const settings = await db.prepare('SELECT * FROM feed_settings WHERE id = 1').first();
  
  // Get feed items with proper parameter binding
  let query = `
    SELECT * FROM feed_items 
    WHERE published = 1
  `;
  let params = [];
  
  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  
  query += ` ORDER BY pub_date DESC LIMIT ?`;
  params.push(limit);
  
  const stmt = params.length > 0 ? db.prepare(query).bind(...params) : db.prepare(query).bind(limit);
  const { results: items } = await stmt.all();
  
  const jsonFeed = {
    version: "https://jsonfeed.org/version/1.1",
    title: settings.title,
    description: settings.description,
    home_page_url: settings.link,
    feed_url: new URL('/feed.json', request.url).toString(),
    language: settings.language,
    items: items.map(item => ({
      id: item.guid || item.id.toString(),
      title: item.title,
      content_html: item.content || item.description,
      summary: item.description,
      url: item.link,
      date_published: item.pub_date,
      date_modified: item.updated_at,
      author: item.author ? { name: item.author } : undefined,
      tags: item.category ? [item.category] : undefined,
    }))
  };
  
  return new Response(JSON.stringify(jsonFeed, null, 2), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    }
  });
}

// Get items (admin endpoint)
async function getItemsHandler(request, db, corsHeaders) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const category = url.searchParams.get('category');
  const published = url.searchParams.get('published');
  const offset = (page - 1) * limit;
  
  let whereConditions = [];
  let params = [];
  
  if (category) {
    whereConditions.push('category = ?');
    params.push(category);
  }
  
  if (published !== null && published !== undefined) {
    whereConditions.push('published = ?');
    params.push(published === 'true' ? 1 : 0);
  }
  
  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
  
  const { results } = await db.prepare(`
    SELECT * FROM feed_items
    ${whereClause}
    ORDER BY pub_date DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();
  
  // Proper parameter binding for count query
  let countParams = [];
  if (category) {
    countParams.push(category);
  }
  
  const countStmt = countParams.length > 0 ? db.prepare(`
    SELECT COUNT(*) as count FROM feed_items ${whereClause}
  `).bind(...countParams) : db.prepare(`
    SELECT COUNT(*) as count FROM feed_items ${whereClause}
  `);
  
  const { count } = await countStmt.first();
  
  return new Response(JSON.stringify({
    items: results,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit)
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Add new item (protected)
async function addItemHandler(request, db, broadcastToken, corsHeaders) {
  if (!await verifyAuth(request, broadcastToken)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const data = await request.json();
  const { title, description, content, link, author, category, guid, published = true } = data;
  
  if (!title) {
    return new Response('Title is required', { status: 400, headers: corsHeaders });
  }
  
  const itemGuid = guid || generateGUID();
  
  const result = await db.prepare(`
    INSERT INTO feed_items (title, description, content, link, author, category, guid, published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(title, description || '', content || '', link || '', author || '', category || '', itemGuid, published ? 1 : 0).run();
  
  return new Response(JSON.stringify({ 
    id: result.meta.last_row_id,
    guid: itemGuid,
    message: 'Item added successfully' 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Update item (protected)
async function updateItemHandler(itemId, request, db, broadcastToken, corsHeaders) {
  if (!await verifyAuth(request, broadcastToken)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const data = await request.json();
  const { title, description, content, link, author, category, published } = data;
  
  const updates = [];
  const params = [];
  
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (content !== undefined) { updates.push('content = ?'); params.push(content); }
  if (link !== undefined) { updates.push('link = ?'); params.push(link); }
  if (author !== undefined) { updates.push('author = ?'); params.push(author); }
  if (category !== undefined) { updates.push('category = ?'); params.push(category); }
  if (published !== undefined) { updates.push('published = ?'); params.push(published ? 1 : 0); }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(itemId);
  
  if (updates.length === 1) { // Only timestamp update
    return new Response('No fields to update', { status: 400, headers: corsHeaders });
  }
  
  await db.prepare(`
    UPDATE feed_items SET ${updates.join(', ')} WHERE id = ?
  `).bind(...params).run();
  
  return new Response(JSON.stringify({ message: 'Item updated successfully' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Delete item (protected)
async function deleteItemHandler(itemId, request, db, broadcastToken, corsHeaders) {
  if (!await verifyAuth(request, broadcastToken)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  await db.prepare('DELETE FROM feed_items WHERE id = ?').bind(itemId).run();
  
  return new Response(JSON.stringify({ message: 'Item deleted successfully' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Broadcast new item (protected)
async function broadcastHandler(request, db, broadcastToken, corsHeaders) {
  if (!await verifyAuth(request, broadcastToken)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const { title, description, content, link, author, category, published = true } = await request.json();
  
  if (!title) {
    return new Response('Title is required', { status: 400, headers: corsHeaders });
  }
  
  const guid = generateGUID();
  
  const result = await db.prepare(`
    INSERT INTO feed_items (title, description, content, link, author, category, guid, published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(title, description || '', content || '', link || '', author || '', category || '', guid, published ? 1 : 0).run();
  
  return new Response(JSON.stringify({ 
    id: result.meta.last_row_id,
    guid,
    message: 'Item broadcast successfully',
    feedUrl: '/feed.xml'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Get feed settings
async function getSettingsHandler(db, corsHeaders) {
  const settings = await db.prepare('SELECT * FROM feed_settings WHERE id = 1').first();
  
  return new Response(JSON.stringify(settings), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Update feed settings (protected)
async function updateSettingsHandler(request, db, broadcastToken, corsHeaders) {
  if (!await verifyAuth(request, broadcastToken)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const data = await request.json();
  const { title, description, link, language, copyright, managing_editor, webmaster, generator, image_url, image_title, image_link } = data;
  
  const updates = [];
  const params = [];
  
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (link !== undefined) { updates.push('link = ?'); params.push(link); }
  if (language !== undefined) { updates.push('language = ?'); params.push(language); }
  if (copyright !== undefined) { updates.push('copyright = ?'); params.push(copyright); }
  if (managing_editor !== undefined) { updates.push('managing_editor = ?'); params.push(managing_editor); }
  if (webmaster !== undefined) { updates.push('webmaster = ?'); params.push(webmaster); }
  if (generator !== undefined) { updates.push('generator = ?'); params.push(generator); }
  if (image_url !== undefined) { updates.push('image_url = ?'); params.push(image_url); }
  if (image_title !== undefined) { updates.push('image_title = ?'); params.push(image_title); }
  if (image_link !== undefined) { updates.push('image_link = ?'); params.push(image_link); }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  
  if (updates.length === 1) {
    return new Response('No fields to update', { status: 400, headers: corsHeaders });
  }
  
  await db.prepare(`
    UPDATE feed_settings SET ${updates.join(', ')} WHERE id = 1
  `).bind(...params).run();
  
  return new Response(JSON.stringify({ message: 'Settings updated successfully' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Generate RSS XML
function generateRSSXML(settings, items, baseUrl) {
  const baseURL = new URL(baseUrl).origin;
  const buildDate = new Date().toUTCString();
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title><![CDATA[${settings.title}]]></title>
  <description><![CDATA[${settings.description}]]></description>
  <link>${settings.link || baseURL}</link>
  <atom:link href="${baseURL}/feed.xml" rel="self" type="application/rss+xml"/>
  <language>${settings.language}</language>
  <lastBuildDate>${buildDate}</lastBuildDate>
  <generator>${settings.generator || 'PolySend.io Notification Service'}</generator>`;

  if (settings.copyright) {
    xml += `\n  <copyright><![CDATA[${settings.copyright}]]></copyright>`;
  }
  
  if (settings.managing_editor) {
    xml += `\n  <managingEditor><![CDATA[${settings.managing_editor}]]></managingEditor>`;
  }
  
  if (settings.webmaster) {
    xml += `\n  <webMaster><![CDATA[${settings.webmaster}]]></webMaster>`;
  }
  
  if (settings.image_url) {
    xml += `\n  <image>
    <url>${settings.image_url}</url>
    <title><![CDATA[${settings.image_title || settings.title}]]></title>
    <link>${settings.image_link || settings.link || baseURL}</link>
  </image>`;
  }

  for (const item of items) {
    const pubDate = new Date(item.pub_date).toUTCString();
    
    xml += `\n  <item>
    <title><![CDATA[${item.title}]]></title>
    <description><![CDATA[${item.description || ''}]]></description>`;
    
    if (item.content) {
      xml += `\n    <content:encoded><![CDATA[${item.content}]]></content:encoded>`;
    }
    
    if (item.link) {
      xml += `\n    <link>${item.link}</link>`;
    }
    
    if (item.author) {
      xml += `\n    <author><![CDATA[${item.author}]]></author>`;
    }
    
    if (item.category) {
      xml += `\n    <category><![CDATA[${item.category}]]></category>`;
    }
    
    xml += `\n    <guid isPermaLink="false">${item.guid || item.id}</guid>
    <pubDate>${pubDate}</pubDate>
  </item>`;
  }

  xml += `\n</channel>
</rss>`;

  return xml;
}

// Helper functions
async function verifyAuth(request, broadcastToken) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.substring(7);
  return token === broadcastToken;
}

function generateGUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


function getAPIDocumentation() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>PolySend.io Notification Service API</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
    .endpoint { background: #e8f4f8; padding: 10px; margin: 10px 0; border-radius: 5px; }
  </style>
</head>
<body>
  <h1>PolySend.io Notification Service API</h1>
  
  <h2>Public Endpoints</h2>
  <div class="endpoint">
    <strong>GET /feed.xml</strong> or <strong>/rss.xml</strong> or <strong>/feed</strong><br>
    Returns RSS XML feed<br>
    Query params: <code>limit</code> (default: 20), <code>category</code>
  </div>
  
  <div class="endpoint">
    <strong>GET /feed.json</strong> or <strong>/json</strong><br>
    Returns JSON feed<br>
    Query params: <code>limit</code> (default: 20), <code>category</code>
  </div>
  
  <div class="endpoint">
    <strong>GET /settings</strong><br>
    Returns feed settings (title, description, etc.)
  </div>
  
  <p><a href="https://polysend.io">Visit PolySend.io</a></p>
</body>
</html>`;
}