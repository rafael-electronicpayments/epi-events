export function createRepository(client) {
  const result = async request => {
    const { data, error } = await request;
    if (error) throw error;
    return data;
  };
  return {
    session: async () => (await result(client.auth.getSession())).session,
    subscribe: callback => {
      const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
      return () => data.subscription.unsubscribe();
    },
    signIn: email => result(client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + '/' }
    })),
    signOut: () => result(client.auth.signOut()),
    load: () => result(client.rpc('ops_snapshot')),
    command: (action, args, revision) => result(client.rpc('ops_command', {
      action, args, expected_revision: revision
    }))
  };
}
