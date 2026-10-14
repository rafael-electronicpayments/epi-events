export function createConnection(React, html, repository, App, hydrate) {
  const { useState, useEffect, useRef } = React;
  return function Connection() {
    const [session, setSession] = useState(undefined);
    const [snapshot, setSnapshot] = useState(null);
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [eventName, setEventName] = useState('');
    const [start, setStart] = useState('');
    const [days, setDays] = useState(3);
    const writing = useRef(false);
    const generation = useRef(0);
    const current = useRef(null);
    const userId = useRef(null);
    const accept = data => {
      // A late polling response must never undo a newer committed write.
      if (current.current && data.revision < current.current.revision) return;
      hydrate(data);
      current.current = data;
      setSnapshot(data);
    };
    useEffect(() => {
      let active = true;
      repository.session().then(s => active && setSession(s)).catch(e => {
        if (active) { setError(e.message); setSession(null); }
      });
      const unsubscribe = repository.subscribe(s => {
        if (userId.current === (s?.user.id || null)) { setSession(s); return; }
        userId.current = s?.user.id || null;
        generation.current++;
        current.current = null;
        setSnapshot(null);
        setError('');
        setSession(s);
      });
      return () => { active = false; generation.current++; unsubscribe(); };
    }, []);
    const refresh = async () => {
      const token = generation.current;
      try {
        const data = await repository.load();
        if (token === generation.current) { accept(data); setError(''); }
      } catch (e) { if (token === generation.current) setError(e.message); }
    };
    useEffect(() => {
      if (!session) return;
      refresh();
      const timer = setInterval(() => { if (!writing.current) refresh(); }, 10000);
      const focus = () => { if (!writing.current) refresh(); };
      window.addEventListener('focus', focus);
      return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
    }, [session?.user.id]);
    const command = async (action, args, expectedRevision) => {
      if (writing.current || !current.current) return false;
      writing.current = true;
      setBusy(true); setError('');
      const token = generation.current;
      try {
        const data = await repository.command(action, args, expectedRevision ?? current.current.revision);
        if (token === generation.current) accept(data);
        return token === generation.current;
      } catch (e) {
        if (token === generation.current) {
          await refresh();
          setError(e.code === '40001' ? 'Another user changed the data. Reopen the record before saving your changes.' : e.message);
        }
        return false;
      } finally { writing.current = false; setBusy(false); }
    };
    const signOut = async () => {
      try { await repository.signOut(); } catch (e) { setError(e.message); }
    };
    if (session === undefined) return html`<main className="wrap m"><h1>Impact Event Ops</h1><p role="status">Connecting...</p></main>`;
    if (!session) return html`<main className="wrap m auth"><h1>Impact Event Ops</h1>
      <form onSubmit=${async e => {
        e.preventDefault(); setBusy(true); setMessage(''); setError('');
        try { await repository.signIn(email.trim()); setMessage('Check your email for your sign-in link.'); }
        catch (e) { setError(e.message); } finally { setBusy(false); }
      }}><label>Email address<input type="email" autoComplete="email" required value=${email} onChange=${e => setEmail(e.target.value)}/></label>
      <button className="btn" disabled=${busy}>${busy ? 'Sending...' : 'Send sign-in link'}</button></form>
      ${message && html`<p role="status">${message}</p>`}${error && html`<p className="connection-error" role="alert">${error}</p>`}</main>`;
    const banner = html`<div className="wrap connection-status">${error && html`<p className="connection-error" role="alert">${error}</p>`}
      <span>${busy ? 'Saving...' : session.user.email}</span><div className="acts"><button className="btn ghost" disabled=${busy} onClick=${refresh}>Refresh</button><button className="btn ghost" disabled=${busy} onClick=${signOut}>Sign out</button></div></div>`;
    if (!snapshot) return html`<main><header className="top"><h1>Impact Event Ops</h1></header>${banner}${!error && html`<p className="wrap" role="status">Loading...</p>`}</main>`;
    if (!snapshot.events.length) return html`<main><header className="top"><h1>Impact Event Ops</h1></header>${banner}
      <div className="wrap m">${snapshot.role === 'admin' ? html`<h2>Create your first event</h2><form className="form" onSubmit=${async e => {
        e.preventDefault(); await command('addEvent', [{ n: eventName.trim(), b: start, d: Number(days) }]);
      }}><label>Event name<input required value=${eventName} onChange=${e => setEventName(e.target.value)}/></label>
      <label>Start date<input type="date" required value=${start} onChange=${e => setStart(e.target.value)}/></label>
      <label>Days<input type="number" min="1" max="14" required value=${days} onChange=${e => setDays(e.target.value)}/></label>
      <button className="btn" disabled=${busy}>Create event</button></form>` : html`<h2>No assignments yet</h2>
      ${snapshot.notes.filter(n=>!n.done).map(n=>html`<div className="card note" key=${n.id}><p>${n.x}</p><button className="btn" disabled=${busy} onClick=${()=>command('dismiss',[n.id])}>Got it</button></div>`)}`}</div></main>`;
    return html`<div>${banner}<fieldset className="workspace" disabled=${busy}><${App} connected=${{ snapshot, command }}/></fieldset></div>`;
  };
}
