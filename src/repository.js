export function createRepository(client, { testLoginsEnabled = false, testLoginEndpoint = '/api/test-logins', passwordRecovery = false } = {}) {
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
    command: (action, args, revision) => action === 'addStaff' || action === 'editStaff'
      ? result(client.rpc('ops_save_person', {
        target_person_id: action === 'editStaff' ? args[0] : null,
        person: action === 'editStaff' ? args[1] : args[0],
        expected_revision: revision
      }))
      : result(client.rpc('ops_command', { action, args, expected_revision: revision }))
  };
}
