export function createRepository(client, { testLoginsEnabled = false, testLoginEndpoint = '/api/test-logins', passwordRecovery = false, pushKey = '' } = {}) {
  const result = async request => {
    const { data, error } = await request;
    if (error) throw error;
    return data;
  };
  return {
    testLoginsEnabled,
    passwordRecovery,
    session: async () => (await result(client.auth.getSession())).session,
    subscribe: callback => {
      const { data } = client.auth.onAuthStateChange((event, session) => callback(session, event));
      return () => data.subscription.unsubscribe();
    },
    signIn: (email, password) => result(client.auth.signInWithPassword({ email, password })),
    resetPassword: email => result(client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/' })),
    updatePassword: password => result(client.auth.updateUser({ password })),
    // Signed-in password change: confirm the current password first, then set the new one.
    changePassword: async (current, next) => {
      const session = (await result(client.auth.getSession())).session;
      if (!session?.user?.email) throw Object.assign(new Error('Sign in again to change your password.'), { code: 'no_session' });
      const check = await client.auth.signInWithPassword({ email: session.user.email, password: current });
      if (check.error) throw Object.assign(new Error('Your current password is not correct.'), { code: 'wrong_password' });
      await result(client.auth.updateUser({ password: next }));
    },
    testLogins: async (action, personId) => {
      if (!testLoginsEnabled) throw new Error('Test logins are available on staging only.');
      const session = (await result(client.auth.getSession())).session;
      if (!session) throw new Error('Sign in required.');
      const response = await fetch(testLoginEndpoint, { method: 'POST', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(personId === undefined ? {} : { personId }) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Test login request failed.');
      return data;
    },
    signOut: () => result(client.auth.signOut()),
    load: () => result(client.rpc('ops_snapshot')),
    // App settings branding (public: shown before sign-in). Older databases don't have it; callers fall back.
    branding: () => result(client.rpc('app_branding')),
    appIconUpload: (path, blob) => result(client.storage.from('app-icons').upload(path, blob, { contentType: 'image/png', upsert: false })),
    appIconRemove: paths => result(client.storage.from('app-icons').remove(paths)),
    // Push notifications: each person registers or removes only their own devices.
    pushKey,
    pushRegister: (subscription, device) => result(client.rpc('push_register', { subscription, device })),
    pushUnregister: endpoint => result(client.rpc('push_unregister', { endpoint })),
    // Floorplan PDFs live in the private 'floorplans' Storage bucket; access is enforced by Storage policies.
    floorplanUpload: (path, data) => result(client.storage.from('floorplans').upload(path, new Blob([data], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })),
    floorplanFile: async path => new Uint8Array(await (await result(client.storage.from('floorplans').download(path))).arrayBuffer()),
    floorplanRemove: path => result(client.storage.from('floorplans').remove([path])),
    // Event logos live in the private 'event-logos' bucket under '<event id>/'.
    logoUpload: (path, data, type) => result(client.storage.from('event-logos').upload(path, new Blob([data], { type }), { contentType: type, upsert: false })),
    logoFile: async path => new Uint8Array(await (await result(client.storage.from('event-logos').download(path))).arrayBuffer()),
    logoRemove: path => result(client.storage.from('event-logos').remove([path])),
    // Event documents live in the private 'documents' bucket under '<event id>/'; viewing is limited by Storage policies.
    documentUpload: (path, data, type) => result(client.storage.from('documents').upload(path, new Blob([data], { type }), { contentType: type, upsert: false })),
    documentFile: async path => new Uint8Array(await (await result(client.storage.from('documents').download(path))).arrayBuffer()),
    documentRemove: path => result(client.storage.from('documents').remove([path])),
    // Expense receipts live in the private 'receipts' bucket under '<person id>/'.
    receiptUpload: (path, data, type) => result(client.storage.from('receipts').upload(path, new Blob([data], { type }), { contentType: type, upsert: false })),
    receiptFile: async path => new Uint8Array(await (await result(client.storage.from('receipts').download(path))).arrayBuffer()),
    receiptRemove: path => result(client.storage.from('receipts').remove([path])),
    command: (action, args, revision) => action === 'addStaff' || action === 'editStaff'
      ? result(client.rpc('ops_save_person', {
        target_person_id: action === 'editStaff' ? args[0] : null,
        person: action === 'editStaff' ? args[1] : args[0],
        expected_revision: revision
      }))
      : result(client.rpc('ops_command', { action, args, expected_revision: revision }))
  };
}
