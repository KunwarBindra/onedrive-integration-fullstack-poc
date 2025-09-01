require('dotenv').config(); // Load CLIENT_ID, CLIENT_SECRET, etc. from .env

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer(); // middleware for file uploads

app.use(express.json());
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));  // allow React dev server origin

// OAuth and Graph API config
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:5000/auth/callback';
const TENANT = process.env.AUTH_TENANT || 'common';  // 'common' for multi-tenant (MSA+Org)
const OAUTH_AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const OAUTH_TOKEN_URL     = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const OAUTH_SCOPES = 'Files.ReadWrite.All offline_access';

// In-memory session store (sessionId -> token data)
const sessions = {};

// Middleware to protect API routes
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sessionId = auth.split(' ')[1];
  const session = sessions[sessionId];
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  req.sessionId = sessionId;
  req.session = session;
  return next();
}

// Utility: Refresh access token using refresh_token
async function refreshAccessToken(sessionId) {
  const session = sessions[sessionId];
  if (!session || !session.refreshToken) return false;
  try {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      redirect_uri: REDIRECT_URI,
      scope: OAUTH_SCOPES
    });
    const response = await axios.post(OAUTH_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = response.data;
    // Update tokens in session
    session.accessToken = data.access_token;
    if (data.refresh_token) {
      session.refreshToken = data.refresh_token; // refresh token might be rotated
    }
    session.expiresAt = Date.now() + (data.expires_in * 1000) - 5 * 60 * 1000; // new expiry time (5 min buffer)
    return true;
  } catch (err) {
    console.error('Refresh token error:', err.response?.data || err.message);
    delete sessions[sessionId]; // remove session if refresh failed
    return false;
  }
}

// Utility: Perform Graph API request with automatic token refresh
async function graphRequest(sessionId, method, url, data) {
  const session = sessions[sessionId];
  if (!session) throw { status: 401, data: { error: 'Session not found' } };

  // Refresh if token expired
  if (session.expiresAt && Date.now() > session.expiresAt) {
    await refreshAccessToken(sessionId);
  }
  try {
    const res = await axios({
      method: method,
      url: url,
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: data
    });
    return res.data;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      // Token might have expired or revoked – try one refresh
      const ok = await refreshAccessToken(sessionId);
      if (ok) {
        const res2 = await axios({
          method: method,
          url: url,
          headers: { Authorization: `Bearer ${session.accessToken}` },
          data: data
        });
        return res2.data;
      }
      throw { status: 401, data: { error: 'Access token expired or invalid. Please log in again.' } };
    }
    // Propagate other errors
    if (err.response) {
      throw { status: err.response.status, data: err.response.data };
    } else {
      throw { status: 500, data: { error: err.message } };
    }
  }
}

// *** Authentication Routes ***

// Step 1: Redirect user to Microsoft OAuth 2.0 authorization endpoint
app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: OAUTH_SCOPES
    // state param could be added for CSRF protection
  });
  res.redirect(`${OAUTH_AUTHORIZE_URL}?${params.toString()}`);
});

// Step 2: OAuth callback – exchange code for tokens
app.get('/auth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) {
    console.error('OAuth error:', error, error_description);
    return res.status(500).send("Authentication error: " + error);
  }
  if (!code) {
    return res.status(400).send("No auth code received");
  }
  try {
    // Prepare token request
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      scope: OAUTH_SCOPES
    });
    const tokenRes = await axios.post(OAUTH_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = tokenRes.data;
    // Create user session
    const sessionId = uuidv4();
    sessions[sessionId] = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000) - 5 * 60 * 1000
    };
    console.log(`New session ${sessionId} for user tokens (expires in ${data.expires_in}s)`);
    // Redirect back to frontend with the sessionId (as a URL param or hash)
    res.redirect(`http://localhost:3000?sessionId=${sessionId}`);
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err.message);
    res.status(500).send("Failed to exchange auth code for tokens");
  }
});

// *** API Routes (protected) ***

// List files and folders in OneDrive (root or given folder)
app.get('/api/files', requireAuth, async (req, res) => {
  let apiUrl;
  if (req.query.id) {
    apiUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${req.query.id}/children`;
  } else if (req.query.path) {
    const path = req.query.path;
    apiUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(path)}:/children`;
  } else {
    apiUrl = `https://graph.microsoft.com/v1.0/me/drive/root/children`;
  }
  try {
    const result = await graphRequest(req.sessionId, 'GET', apiUrl);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json(err.data || { error: 'Unknown error' });
  }
});

// List files shared *with* the logged-in user
app.get('/api/shared', requireAuth, async (req, res) => {
  const apiUrl = `https://graph.microsoft.com/v1.0/me/drive/sharedWithMe?allowexternal=true`;
  try {
    const result = await graphRequest(req.sessionId, 'GET', apiUrl);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json(err.data || { error: 'Unknown error' });
  }
});

// Create a new folder
app.post('/api/create-folder', requireAuth, async (req, res) => {
  const { name, parentId } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  const apiUrl = parentId 
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children` 
    : `https://graph.microsoft.com/v1.0/me/drive/root/children`;
  const body = {
    name: name,
    folder: {}, 
    "@microsoft.graph.conflictBehavior": "fail"
  };
  try {
    const newFolder = await graphRequest(req.sessionId, 'POST', apiUrl, body);
    res.status(201).json(newFolder);
  } catch (err) {
    res.status(err.status || 500).json(err.data || { error: 'Folder creation failed' });
  }
});

// Upload a small file (<4MB)
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileName = req.file.originalname;
  let apiUrl;
  if (req.body.parentId) {
    apiUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${req.body.parentId}:/${encodeURIComponent(fileName)}:/content`;
  } else if (req.body.path) {
    // Ensure path includes the filename
    let path = req.body.path;
    if (!path.endsWith(fileName)) {
      if (!path.endsWith('/')) path += '/';
      path += fileName;
    }
    apiUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(path)}:/content`;
  } else {
    apiUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(fileName)}:/content`;
  }
  try {
    const session = sessions[req.sessionId];
    const response = await axios.put(apiUrl, req.file.buffer, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': req.file.mimetype || 'application/octet-stream'
      }
    });
    res.status(201).json(response.data);
  } catch (err) {
    if (err.response?.status === 409) {
      // Name conflict
      return res.status(409).json({ error: 'File already exists' });
    }
    console.error('Upload error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Upload failed' });
  }
});

// Rename a file or folder
app.patch('/api/items/:id', requireAuth, async (req, res) => {
  const itemId = req.params.id;
  const newName = req.body.name;
  if (!newName) {
    return res.status(400).json({ error: 'New name is required' });
  }
  const apiUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}`;
  try {
    const updated = await graphRequest(req.sessionId, 'PATCH', apiUrl, { name: newName });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json(err.data || { error: 'Rename failed' });
  }
});

// Delete a file or folder
app.delete('/api/items/:id', requireAuth, async (req, res) => {
  const itemId = req.params.id;
  const apiUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}`;
  try {
    await graphRequest(req.sessionId, 'DELETE', apiUrl);
    res.sendStatus(204);
  } catch (err) {
    res.status(err.status || 500).json(err.data || { error: 'Delete failed' });
  }
});

// Share a file/folder with specified emails (role: view or edit)
app.post('/api/share', requireAuth, async (req, res) => {
  const { itemId, emails, role = 'view', message = '' } = req.body;
  if (!itemId || !emails) {
    return res.status(400).json({ error: 'itemId and emails are required' });
  }
  const recipients = emails.map(email => ({ email }));
  const permRole = (role.toLowerCase() === 'edit' || role.toLowerCase() === 'write') ? 'write' : 'read';
  const apiUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/invite`;
  const body = {
    recipients: recipients,
    requireSignIn: true,
    sendInvitation: true,
    roles: [permRole],
    message: message
  };
  try {
    const inviteResponse = await graphRequest(req.sessionId, 'POST', apiUrl, body);
    res.json(inviteResponse);
  } catch (err) {
    res.status(err.status || 500).json(err.data || { error: 'Share failed' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});