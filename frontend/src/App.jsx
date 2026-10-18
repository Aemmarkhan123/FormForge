import { useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5001";
const path = window.location.pathname;
const publicSlug = path.startsWith("/f/") ? path.slice(3) : null;

const emptyField = () => ({
  id: crypto.randomUUID(),
  label: "Untitled question",
  type: "text",
  required: true,
  options: ["Option 1", "Option 2"],
});

export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem("aym_token") || ""
  );
  const [email, setEmail] = useState(
    () => localStorage.getItem("aym_email") || ""
  );
  const [mode, setMode] = useState("login");
  const [page, setPage] = useState("dashboard");
  const [forms, setForms] = useState([]);
  const [current, setCurrent] = useState(null);
  const [responses, setResponses] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [auth, setAuth] = useState({ email: "", password: "" });
  const [publicForm, setPublicForm] = useState(null);
  const [answers, setAnswers] = useState({});
  const [respondentEmail, setRespondentEmail] = useState("");

  const [draft, setDraft] = useState({
    title: "Untitled form",
    description: "",
    fields: [emptyField()],
  });

  async function request(url, options = {}) {
    const response = await fetch(`${API}${url}`, {
      ...options,
      headers: {
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && !url.startsWith("/public/")) {
      localStorage.removeItem("aym_token");
      localStorage.removeItem("aym_email");
      setToken("");
      setEmail("");
    }

    if (!response.ok) {
      throw new Error(data.message || "Request failed.");
    }

    return data;
  }

  async function loadForms() {
    const data = await request("/forms");
    setForms(data.forms);
  }

  useEffect(() => {
    if (!publicSlug) return;

    setLoading(true);

    fetch(`${API}/public/forms/${encodeURIComponent(publicSlug)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Form not found.");
        setPublicForm(data.form);
      })
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Restore and validate the saved session after refresh.
  useEffect(() => {
    if (!token || publicSlug) return;

    loadForms().catch((err) => {
      setMessage(err.message);
    });
  }, [token]);

  async function authenticate(endpoint, body) {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Authentication failed.");
      }

      if (!data.token) {
        setMessage(data.message || "Check your email to continue.");
        return;
      }

      // Persist the session across browser refreshes.
      localStorage.setItem("aym_token", data.token);
      localStorage.setItem("aym_email", data.email);

      setToken(data.token);
      setEmail(data.email);
      setAuth({ email: data.email, password: "" });
      setPage("dashboard");
      setMessage("");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function createForm() {
    setLoading(true);
    setMessage("");

    try {
      const data = await request("/forms", {
        method: "POST",
        body: JSON.stringify(draft),
      });

      setCurrent(data.form);
      setDraft({
        title: data.form.title,
        description: data.form.description,
        fields: data.form.fields,
      });

      setPage("editor");
      await loadForms();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  function editForm(form) {
    setCurrent(form);
    setDraft({
      title: form.title,
      description: form.description,
      fields: form.fields.map((field) => ({
        ...field,
        options: [...(field.options || [])],
      })),
    });
    setMessage("");
    setPage("editor");
  }

  async function saveForm() {
    if (!current) return false;

    setLoading(true);
    setMessage("");

    try {
      const data = await request(`/forms/${current.id}`, {
        method: "PUT",
        body: JSON.stringify(draft),
      });

      setCurrent(data.form);
      setDraft({
        title: data.form.title,
        description: data.form.description,
        fields: data.form.fields,
      });

      await loadForms();
      setMessage("Changes saved.");
      return true;
    } catch (err) {
      setMessage(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function publishForm() {
    if (!current) return;

    // Save first; never publish stale draft data.
    const saved = await saveForm();
    if (!saved) return;

    setLoading(true);

    try {
      const data = await request(`/forms/${current.id}/publish`, {
        method: "POST",
      });

      setCurrent((prev) => ({ ...prev, published: true }));
      await loadForms();
      setMessage(`Published! Share this link: ${data.shareUrl}`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function togglePublish(form) {
    try {
      const action = form.published ? "unpublish" : "publish";
      const data = await request(`/forms/${form.id}/${action}`, {
        method: "POST",
      });

      await loadForms();
      setMessage(data.shareUrl
        ? `Share link: ${data.shareUrl}`
        : data.message);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function showResponses(form) {
    try {
      const data = await request(`/forms/${form.id}/responses`);
      setCurrent(form);
      setResponses(data.responses);
      setPage("responses");
      setMessage("");
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function deleteForm(form) {
    if (!window.confirm(
      `Delete "${form.title}" and all its responses?`
    )) return;

    try {
      await request(`/forms/${form.id}`, { method: "DELETE" });
      await loadForms();
      setMessage("Form deleted.");
    } catch (err) {
      setMessage(err.message);
    }
  }

  function updateField(index, changes) {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((field, i) =>
        i === index ? { ...field, ...changes } : field
      ),
    }));
  }

  async function submitPublicForm(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `${API}/public/forms/${encodeURIComponent(publicSlug)}/responses`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers, respondentEmail }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Submission failed.");
      }

      setMessage(data.message);
      setAnswers({});
      setRespondentEmail("");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("aym_token");
    localStorage.removeItem("aym_email");

    setToken("");
    setEmail("");
    setForms([]);
    setCurrent(null);
    setResponses([]);
    setMessage("");
    setPage("dashboard");
  }

  // PUBLIC FORM
  if (publicSlug) {
    return (
      <main className="page public-page">
        <section className="panel public-panel">
          <div className="brand">aym<span>.</span></div>

          {loading && <p className="muted">Loading form...</p>}

          {!loading && publicForm && (
            <>
              <h1>{publicForm.title}</h1>
              {publicForm.description && (
                <p className="subtitle">{publicForm.description}</p>
              )}

              <form onSubmit={submitPublicForm}>
                {publicForm.fields.map((field) => (
                  <div className="question" key={field.id}>
                    <label htmlFor={field.id}>
                      {field.label}{field.required ? " *" : ""}
                    </label>

                    {field.type === "textarea" ? (
                      <textarea
                        id={field.id}
                        required={field.required}
                        maxLength={5000}
                        value={answers[field.id] || ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [field.id]: e.target.value,
                          }))
                        }
                      />
                    ) : field.type === "select" ? (
                      <select
                        id={field.id}
                        required={field.required}
                        value={answers[field.id] || ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [field.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">Choose an option</option>
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "radio" ? (
                      <div className="radio-list">
                        {field.options.map((option) => (
                          <label className="radio-option" key={option}>
                            <input
                              type="radio"
                              name={field.id}
                              required={field.required}
                              checked={answers[field.id] === option}
                              onChange={() =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [field.id]: option,
                                }))
                              }
                            />
                            {option}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <input
                        id={field.id}
                        type={
                          field.type === "number" ? "number" :
                          field.type === "email" ? "email" : "text"
                        }
                        required={field.required}
                        maxLength={5000}
                        value={answers[field.id] || ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [field.id]: e.target.value,
                          }))
                        }
                      />
                    )}
                  </div>
                ))}

                <label htmlFor="respondent-email">
                  Your email (optional)
                </label>
                <input
                  id="respondent-email"
                  type="email"
                  value={respondentEmail}
                  onChange={(e) => setRespondentEmail(e.target.value)}
                  placeholder="you@example.com"
                />

                <button className="primary" disabled={loading}>
                  {loading ? "Submitting..." : "Submit response"}
                </button>
              </form>
            </>
          )}

          {message && <p className="notice">{message}</p>}
        </section>
      </main>
    );
  }

  // LOGIN / SIGNUP
  if (!token) {
    return (
      <main className="page">
        <section className="panel auth-panel">
          <div className="brand">aym<span>.</span></div>
          <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p className="subtitle">
            Build forms and collect responses in one place.
          </p>

          <div className="tabs">
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => { setMode("signup"); setMessage(""); }}
            >Sign up</button>
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => { setMode("login"); setMessage(""); }}
            >Log in</button>
          </div>

          <form onSubmit={(e) => {
            e.preventDefault();
            authenticate(`/${mode}`, auth);
          }}>
            <label htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              value={auth.email}
              onChange={(e) =>
                setAuth({ ...auth, email: e.target.value })
              }
              placeholder="you@example.com"
            />

            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={auth.password}
              onChange={(e) =>
                setAuth({ ...auth, password: e.target.value })
              }
              placeholder="At least 8 characters"
            />

            <button className="primary" disabled={loading}>
              {loading ? "Please wait..." :
                mode === "signup" ? "Create account" : "Log in"}
            </button>
          </form>

          <div className="separator">or</div>

          <div className="google-wrap">
            <GoogleLogin
              onSuccess={(result) =>
                authenticate("/auth/google", {
                  credential: result.credential,
                })
              }
              onError={() => setMessage("Google sign-in failed.")}
              text={mode === "signup" ? "signup_with" : "signin_with"}
              theme="filled_black"
              shape="rectangular"
              width="360"
            />
          </div>

          {message && <p className="notice">{message}</p>}
        </section>
      </main>
    );
  }

  // AUTHENTICATED DASHBOARD
  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage("dashboard")}>
          aym<span>.</span>
        </button>
        <div className="top-actions">
          <span className="muted">{email}</span>
          <button className="secondary small" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">WORKSPACE</p>
          <button
            className={page === "dashboard" ? "nav-item selected" : "nav-item"}
            onClick={() => { setPage("dashboard"); setMessage(""); }}
          >▦ &nbsp; My forms</button>

          {current && (
            <button
              className={page === "editor" ? "nav-item selected" : "nav-item"}
              onClick={() => setPage("editor")}
            >＋ &nbsp; Form editor</button>
          )}
        </aside>

        <section className="content">
          {page === "dashboard" && (
            <>
              <div className="heading-row">
                <div>
                  <p className="eyebrow">YOUR WORKSPACE</p>
                  <h1>My forms</h1>
                  <p className="subtitle">
                    Create forms and collect responses.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setDraft({
                      title: "Untitled form",
                      description: "",
                      fields: [emptyField()],
                    });
                    setCurrent(null);
                    setPage("new");
                    setMessage("");
                  }}
                >＋ Create form</button>
              </div>

              {forms.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">▤</div>
                  <h2>No forms yet</h2>
                  <p className="muted">Create your first form to get started.</p>
                </div>
              ) : (
                <div className="form-grid">
                  {forms.map((form) => (
                    <article className="form-card" key={form.id}>
                      <div className="form-card-top">
                        <span className="form-icon">▤</span>
                        <span className={form.published ? "status live" : "status"}>
                          {form.published ? "Published" : "Draft"}
                        </span>
                      </div>

                      <h2>{form.title}</h2>
                      <p className="muted clamp">
                        {form.description || "No description"}
                      </p>

                      <div className="card-meta">
                        <span>{form.fields.length} questions</span>
                        <span>{form.responseCount} responses</span>
                      </div>

                      <div className="card-actions">
                        <button className="secondary" onClick={() => editForm(form)}>
                          Edit
                        </button>
                        <button className="secondary" onClick={() => showResponses(form)}>
                          Responses
                        </button>
                      </div>

                      <div className="card-actions">
                        <button className="secondary" onClick={() => togglePublish(form)}>
                          {form.published ? "Unpublish" : "Publish"}
                        </button>

                        {form.published && (
                          <button
                            className="secondary"
                            onClick={() => {
                              const url =
                                `${window.location.origin}/f/${form.slug}`;
                              navigator.clipboard.writeText(url)
                                .then(() => setMessage(`Copied: ${url}`))
                                .catch(() => setMessage(`Share link: ${url}`));
                            }}
                          >Copy link</button>
                        )}

                        <button className="danger" onClick={() => deleteForm(form)}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {(page === "new" || page === "editor") && (
            <>
              <div className="heading-row">
                <div>
                  <p className="eyebrow">FORM BUILDER</p>
                  <h1>{page === "new" ? "Create a form" : "Edit your form"}</h1>
                </div>
                <button className="secondary" onClick={() => setPage("dashboard")}>
                  Back
                </button>
              </div>

              <div className="builder-layout">
                <div className="builder-main">
                  <div className="panel builder-panel">
                    <label>Form title</label>
                    <input
                      maxLength={150}
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                    />

                    <label>Description</label>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={draft.description}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                      placeholder="Describe this form..."
                    />
                  </div>

                  {draft.fields.map((field, index) => (
                    <div className="panel builder-panel question-editor" key={field.id}>
                      <div className="question-editor-header">
                        <span className="muted">QUESTION {index + 1}</span>
                        <button
                          className="danger"
                          disabled={draft.fields.length === 1}
                          onClick={() => setDraft({
                            ...draft,
                            fields: draft.fields.filter((_, i) => i !== index),
                          })}
                        >Remove</button>
                      </div>

                      <label>Question label</label>
                      <input
                        maxLength={200}
                        value={field.label}
                        onChange={(e) =>
                          updateField(index, { label: e.target.value })
                        }
                      />

                      <label>Answer type</label>
                      <select
                        value={field.type}
                        onChange={(e) =>
                          updateField(index, { type: e.target.value })
                        }
                      >
                        <option value="text">Short answer</option>
                        <option value="textarea">Long answer</option>
                        <option value="email">Email address</option>
                        <option value="number">Number</option>
                        <option value="select">Dropdown</option>
                        <option value="radio">Multiple choice</option>
                      </select>

                      {["select", "radio"].includes(field.type) && (
                        <>
                          <label>Options (one per line)</label>
                          <textarea
                            rows={4}
                            value={field.options.join("\n")}
                            onChange={(e) =>
                              updateField(index, {
                                options: e.target.value.split("\n"),
                              })
                            }
                          />
                        </>
                      )}

                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) =>
                            updateField(index, { required: e.target.checked })
                          }
                        />
                        Required question
                      </label>
                    </div>
                  ))}

                  <button
                    className="secondary add-question"
                    disabled={draft.fields.length >= 50}
                    onClick={() => setDraft({
                      ...draft,
                      fields: [...draft.fields, emptyField()],
                    })}
                  >＋ Add question</button>
                </div>

                <aside className="builder-aside panel">
                  <p className="eyebrow">PUBLISHING</p>
                  <p className="muted">
                    Save your questions before sharing the form.
                  </p>

                  <button
                    className="primary full"
                    disabled={loading}
                    onClick={page === "new" ? createForm : saveForm}
                  >
                    {loading ? "Saving..." :
                      page === "new" ? "Create form" : "Save changes"}
                  </button>

                  {page === "editor" && (
                    <button
                      className="secondary full"
                      disabled={loading || current?.published}
                      onClick={publishForm}
                    >Publish form</button>
                  )}
                </aside>
              </div>
            </>
          )}

          {page === "responses" && current && (
            <>
              <div className="heading-row">
                <div>
                  <p className="eyebrow">SUBMISSIONS</p>
                  <h1>{current.title}</h1>
                  <p className="subtitle">
                    {responses.length} responses received
                  </p>
                </div>
                <button className="secondary" onClick={() => setPage("dashboard")}>
                  Back
                </button>
              </div>

              {responses.length === 0 ? (
                <div className="empty-state">
                  <h2>No responses yet</h2>
                  <p className="muted">
                    Submissions will appear here.
                  </p>
                </div>
              ) : (
                <div className="responses-list">
                  {responses.map((response, index) => (
                    <article className="panel response-card" key={response.id}>
                      <div className="response-header">
                        <h2>Response {responses.length - index}</h2>
                        <span className="muted">
                          {new Date(response.submittedAt).toLocaleString()}
                        </span>
                      </div>

                      {response.respondentEmail && (
                        <p className="muted">
                          Respondent: {response.respondentEmail}
                        </p>
                      )}

                      {current.fields.map((field) => (
                        <div className="answer-row" key={field.id}>
                          <strong>{field.label}</strong>
                          <p>{response.answers[field.id] || "Not answered"}</p>
                        </div>
                      ))}

                      <p className="muted">
                        Email notification: {response.emailSent ? "Sent" : "Not confirmed"}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {message && (
            <div className="notice global-notice" role="status">
              {message}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
