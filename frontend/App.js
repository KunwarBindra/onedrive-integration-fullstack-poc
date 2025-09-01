import React, { useState, useEffect } from 'react';
import axios from 'axios';

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [files, setFiles] = useState([]);           // current folder items
  const [sharedFiles, setSharedFiles] = useState([]); // "Shared with me" items
  const [crumb, setCrumb] = useState([{ id: null, name: 'Root' }]); // breadcrumb path

  // On initial mount, check URL and localStorage for sessionId
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('sessionId');
    if (sid) {
      localStorage.setItem('sessionId', sid);
      setSessionId(sid);
      // Remove sessionId param from URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const stored = localStorage.getItem('sessionId');
      if (stored) setSessionId(stored);
    }
  }, []);

  // Fetch drive root and shared list when session becomes available
  useEffect(() => {
    if (sessionId) {
      fetchFiles(null);   // load root files
      fetchShared();      // load shared with me list
    }
  }, [sessionId]);

  // Helper to get current folder’s ID from breadcrumb
  const currentFolderId = () => crumb[crumb.length - 1].id;

  // API call: fetch children of given folder (or root if folderId is null)
  const fetchFiles = async (folderId) => {
    try {
      const url = folderId 
        ? `http://localhost:5000/api/files?id=${folderId}` 
        : `http://localhost:5000/api/files`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${sessionId}` } });
      const items = res.data.value || res.data; // Graph returns items in .value
      setFiles(items);
    } catch (err) {
      console.error('Error fetching files:', err.response || err);
      alert('Failed to load files.');
    }
  };

  // API call: fetch "shared with me" list
  const fetchShared = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/shared', {
        headers: { Authorization: `Bearer ${sessionId}` }
      });
      const items = res.data.value || res.data;
      setSharedFiles(items);
    } catch (err) {
      console.error('Error fetching shared items:', err.response || err);
      alert('Failed to load shared items.');
    }
  };

  // Initiate OAuth login via backend
  const login = () => {
    window.location.href = 'http://localhost:5000/auth/login';
  };

  // Log out user (clear session)
  const logout = () => {
    localStorage.removeItem('sessionId');
    setSessionId(null);
    setFiles([]);
    setSharedFiles([]);
    setCrumb([{ id: null, name: 'Root' }]);
  };

  // Create a new folder in current directory
  const createFolder = async (folderName) => {
    if (!folderName) return;
    try {
      await axios.post('http://localhost:5000/api/create-folder', 
        { name: folderName, parentId: currentFolderId() || undefined },
        { headers: { Authorization: `Bearer ${sessionId}` } }
      );
      fetchFiles(currentFolderId());
    } catch (err) {
      console.error('Create folder error:', err.response || err);
      alert('Failed to create folder.');
    }
  };

  // Upload a file to current directory
  const uploadFile = async (file) => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (currentFolderId()) {
        formData.append('parentId', currentFolderId());
      }
      await axios.post('http://localhost:5000/api/upload', formData, {
        headers: {
          Authorization: `Bearer ${sessionId}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      fetchFiles(currentFolderId());
    } catch (err) {
      console.error('Upload error:', err.response || err);
      alert('Failed to upload file.');
    }
  };

  // Delete an item (file or folder)
  const deleteItem = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try {
      await axios.delete(`http://localhost:5000/api/items/${item.id}`, {
        headers: { Authorization: `Bearer ${sessionId}` }
      });
      fetchFiles(currentFolderId());
    } catch (err) {
      console.error('Delete error:', err.response || err);
      alert('Failed to delete item.');
    }
  };

  // Rename an item
  const renameItem = async (item) => {
    const newName = window.prompt(`Enter new name for "${item.name}":`, item.name);
    if (!newName || newName === item.name) return;
    try {
      await axios.patch(`http://localhost:5000/api/items/${item.id}`, 
        { name: newName },
        { headers: { Authorization: `Bearer ${sessionId}` } }
      );
      fetchFiles(currentFolderId());
    } catch (err) {
      console.error('Rename error:', err.response || err);
      alert('Failed to rename item.');
    }
  };

  // Share an item
  const shareItem = async (item) => {
    const email = window.prompt('Enter email to share with:');
    if (!email) return;
    const roleInput = window.prompt('Enter access type ("view" or "edit"):', 'view');
    const role = (roleInput && roleInput.toLowerCase().startsWith('e')) ? 'edit' : 'view';
    try {
      await axios.post('http://localhost:5000/api/share', 
        { itemId: item.id, emails: [email], role: role },
        { headers: { Authorization: `Bearer ${sessionId}` } }
      );
      alert(`Shared "${item.name}" with ${email} (${role} access).`);
    } catch (err) {
      console.error('Share error:', err.response || err);
      alert('Failed to share item.');
    }
  };

  // Handle opening an item
  const openItem = (item) => {
    if (item.folder) {
      // Navigate into folder
      setCrumb([...crumb, { id: item.id, name: item.name }]);
      fetchFiles(item.id);
    } else if (item.file) {
      // Open file in OneDrive (new tab)
      if (item.webUrl) {
        window.open(item.webUrl, '_blank');
      } else {
        alert('No web URL available for this file.');
      }
    } else if (item.remoteItem) {
      // Opening an item from "Shared with me"
      const link = item.webUrl || (item.remoteItem && item.remoteItem.webUrl);
      if (link) {
        window.open(link, '_blank');
      } else {
        alert('No link available for this shared item.');
      }
    }
  };

  // Navigate one level up in breadcrumb
  const goBack = () => {
    if (crumb.length < 2) return;
    const newCrumb = [...crumb];
    newCrumb.pop();
    setCrumb(newCrumb);
    const parent = newCrumb[newCrumb.length - 1];
    fetchFiles(parent.id);
  };

  // If not logged in, show login prompt
  if (!sessionId) {
    return (
      <div style={{ padding: '20px' }}>
        <h2>OneDrive POC</h2>
        <button onClick={login}>Login with Microsoft</button>
      </div>
    );
  }

  // Logged in view
  return (
    <div style={{ padding: '20px' }}>
      <h2>OneDrive POC (Logged In)</h2>
      <button onClick={logout}>Logout</button>

      {/* My Drive Section */}
      <h3>My Drive</h3>
      <div>
        <strong>Path:</strong>
        {crumb.map((c, idx) => (
          <span key={c.id || 'root'}>
            {c.name}{idx < crumb.length - 1 ? ' / ' : ''}
          </span>
        ))}
        {crumb.length > 1 && <button onClick={goBack} style={{ marginLeft: '10px' }}>Back</button>}
      </div>

      {/* Create folder */}
      <div style={{ marginTop: '10px' }}>
        <input id="newFolderName" type="text" placeholder="New folder name" />
        <button onClick={() => {
          const name = document.getElementById('newFolderName').value;
          document.getElementById('newFolderName').value = '';
          createFolder(name);
        }}>
          Create Folder
        </button>
      </div>

      {/* Upload file */}
      <div style={{ marginTop: '10px' }}>
        <input id="fileInput" type="file" />
        <button onClick={() => {
          const fileInput = document.getElementById('fileInput');
          if (fileInput.files.length > 0) {
            uploadFile(fileInput.files[0]);
            fileInput.value = '';  // reset file input
          }
        }}>
          Upload File
        </button>
      </div>

      {/* Files/Folders list */}
      <ul style={{ marginTop: '15px' }}>
        {files.map(item => (
          <li key={item.id}>
            {item.folder ? '📁' : '📄'} <strong>{item.name}</strong>
            {' '}
            <button onClick={() => openItem(item)}>Open</button>
            {/** Folder "Open" navigates, File "Open" opens link **/}
            <button onClick={() => renameItem(item)}>Rename</button>
            <button onClick={() => shareItem(item)}>Share</button>
            <button onClick={() => deleteItem(item)}>Delete</button>
          </li>
        ))}
      </ul>

      {/* Shared With Me Section */}
      <h3>Shared With Me</h3>
      <ul>
        {sharedFiles.map(item => (
          <li key={item.id}>
            {item.remoteItem && item.remoteItem.folder ? '📁' : '📄'} <strong>{item.name || (item.remoteItem && item.remoteItem.name)}</strong>
            {' '}
            <button onClick={() => openItem(item)}>Open</button>
            <em> (Shared by {item.shared?.owner?.user?.displayName || 'someone'})</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;