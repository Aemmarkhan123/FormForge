# AYM Forms

AYM Forms is a self-hosted form builder for creating forms, sharing public links, collecting responses, and receiving email notifications when someone submits a response.

The project uses a React + Vite frontend, a Node.js + Express backend, a local SQLite database, email verification through SMTP, and Google sign-in.

## Features

- Email/password signup and login
- Email verification for new accounts
- Google sign-in
- Session persistence across browser refreshes
- Create and edit forms
- Short-answer, long-answer, email, number, dropdown, and multiple-choice fields
- Publish/unpublish forms and share public links
- Store form responses in SQLite
- Send response notifications to the form creator
- Matte-black responsive interface

## Tech stack

- Frontend: React, Vite
- Backend: Node.js, Express
- Database: SQLite using `better-sqlite3`
- Authentication: JWT, bcrypt, Google Identity Services
- Email: Nodemailer over SMTP

## Prerequisites

Install the following before starting:

- Node.js (prefer an actively supported LTS release; Node.js 20 or newer is recommended)
- npm
- A Google account if you want email delivery through Gmail SMTP
- A Google Cloud project and OAuth client ID if you want Google sign-in

Check your versions:

```bash
node --version
npm --version
```

## Project structure

The project should look roughly like this:

```text
aym-forms/
├── server.js
├── database.js
├── package.json
├── package-lock.json
├── .env
├── .gitignore
├── data/                    # Created locally; SQLite database lives here
└── frontend/
    ├── package.json
    ├── package-lock.json
    ├── .env
    └── src/
        ├── App.jsx
        ├── App.css
        ├── index.css
        └── main.jsx
```

Your exact project may contain additional files. Do not commit `.env` files, database files, or dependency folders.

## 1. Clone the repository

Replace `YOUR_GITHUB_USERNAME` and `YOUR_REPOSITORY` with your actual GitHub details.

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
```

## 2. Install backend dependencies

From the project root:

```bash
npm install
```

The backend dependencies used by this project include:

- `express`
- `cors`
- `nodemailer`
- `bcryptjs`
- `dotenv`
- `jsonwebtoken`
- `google-auth-library`
- `better-sqlite3`

If the repository's `package.json` does not list these packages, install the missing ones:

```bash
npm install express cors nodemailer bcryptjs dotenv jsonwebtoken google-auth-library better-sqlite3
```

If `better-sqlite3` fails to install, check that your Node.js version is supported by the installed package and review its installation requirements for your operating system.

## 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

The frontend should include React, Vite, and `@react-oauth/google`. If dependencies are missing from `frontend/package.json`, install them from the `frontend` directory:

```bash
cd frontend
npm install react react-dom @react-oauth/google
npm install --save-dev vite
cd ..
```

Prefer the dependencies already defined in the repository's package files rather than reinstalling them unnecessarily.

## 4. Configure backend environment variables

Create a file named `.env` in the project root. Never commit this file.

```dotenv
PORT=5001
BASE_URL=http://localhost:5001
FRONTEND_URL=http://localhost:5173

# Email address shown as the form creator / account contact where required
ADMIN_EMAIL=your-email@gmail.com

# Gmail SMTP sender account
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password

# Use a long, random secret (at least 32 characters)
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters

# Google OAuth 2.0 Web client ID
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### Gmail SMTP setup

If you use Gmail to send verification emails and form-response notifications:

1. Enable 2-Step Verification on the Google account used to send email.
2. Create an App Password in your Google Account security settings, if App Passwords are available for your account.
3. Set `SMTP_USER` to the sending Gmail address.
4. Set `SMTP_PASS` to the generated App Password, not your normal Gmail password.

The app sends form-response notifications to the email address that owns the form. `SMTP_USER` is the sending account. `ADMIN_EMAIL` is used only where the backend explicitly references it; it does not automatically determine the notification recipient.

Never put SMTP credentials or JWT secrets in frontend environment variables.

## 5. Configure the frontend environment variables

Create `frontend/.env`:

```dotenv
VITE_API_URL=http://localhost:5001
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Use the same Google OAuth Web client ID in both environment files.

Vite exposes variables prefixed with `VITE_` to browser code. Never put passwords, SMTP credentials, private keys, or JWT signing secrets in `frontend/.env`.

## 6. Configure Google sign-in

Google sign-in requires an OAuth 2.0 client ID.

1. Open the Google Cloud Console: https://console.cloud.google.com/
2. Select or create a Google Cloud project.
3. Configure the OAuth consent screen / Google Auth Platform as prompted.
4. Create an OAuth client of type **Web application**.
5. Add this authorized JavaScript origin for local development:

   ```text
   http://localhost:5173
   ```

6. Copy the client ID into both:
   - `GOOGLE_CLIENT_ID` in the root `.env`
   - `VITE_GOOGLE_CLIENT_ID` in `frontend/.env`

If Google sign-in is not needed, check whether the current application code still renders the Google login component. The frontend may need a valid client ID at startup even if you do not intend to use Google sign-in.

For production, configure the actual production origin in Google Cloud and update the environment variables accordingly. Do not use a localhost origin for a deployed website.

## 7. Verify the database setup

The backend uses SQLite through `better-sqlite3`. The `database.js` file should create the database and tables automatically when the backend starts, and the database is expected to live under the local `data/` directory.

Make sure:

- `database.js` exists in the project root.
- The process can write to the project directory.
- The `data/` directory is not committed if it contains your local database.
- `better-sqlite3` is installed.

No external database server is required.

**Back up your SQLite database before deleting or replacing the local `data/` directory.** Deleting it can remove users, forms, and collected responses.

## 8. Start the backend

Open terminal window 1, from the project root:

```bash
npm start
```

If your `package.json` does not define a `start` script, inspect the `scripts` section. If the backend entry point is `server.js`, you can run:

```bash
node server.js
```

The backend should be available at:

```text
http://localhost:5001
```

If the backend uses a different port in your configuration, use that port consistently in both `.env` files.

## 9. Start the frontend

Open terminal window 2:

```bash
cd frontend
npm run dev
```

Vite normally serves the frontend at:

```text
http://localhost:5173
```

Open that URL in your browser.

Keep both terminal processes running while using the app locally.

## 10. First-run checklist

1. Open `http://localhost:5173`.
2. Create an account using an email address and password.
3. Open the verification email and follow its link.
4. Log in.
5. Try Google sign-in if configured.
6. Create a form and add questions.
7. Save and publish the form.
8. Open its public link in a separate browser window or private session.
9. Submit a test response.
10. Confirm the response appears in the dashboard and that the form owner's email receives a notification.

If verification or notification email does not arrive, check the backend terminal output, SMTP credentials, spam folder, and the backend's email configuration.

## Environment variable summary

| Variable | Location | Purpose |
|---|---|---|
| `PORT` | Root `.env` | Backend listening port |
| `BASE_URL` | Root `.env` | Backend base URL used in verification links |
| `FRONTEND_URL` | Root `.env` | Allowed frontend origin for CORS |
| `ADMIN_EMAIL` | Root `.env` | Admin/contact email where used by backend |
| `SMTP_USER` | Root `.env` | SMTP sending account |
| `SMTP_PASS` | Root `.env` | SMTP credential / Gmail App Password |
| `JWT_SECRET` | Root `.env` | Signs authentication tokens |
| `GOOGLE_CLIENT_ID` | Root `.env` | Backend Google token verification client ID |
| `VITE_API_URL` | `frontend/.env` | Backend URL used by frontend |
| `VITE_GOOGLE_CLIENT_ID` | `frontend/.env` | Google client ID used by frontend |

## Troubleshooting

### Frontend cannot reach the backend

- Confirm the backend is running.
- Confirm `VITE_API_URL` matches the backend URL.
- Confirm `FRONTEND_URL` exactly matches the browser origin, including protocol and port.
- Restart Vite after changing `frontend/.env`.

### CORS error

For local development, these values should normally agree:

```dotenv
# Root .env
FRONTEND_URL=http://localhost:5173

# frontend/.env
VITE_API_URL=http://localhost:5001
```

Do not add a trailing slash unless the backend CORS configuration accounts for it.

### Email verification or response notifications fail

- Check `SMTP_USER` and `SMTP_PASS`.
- Use a Gmail App Password where required.
- Confirm the sender account is allowed to send SMTP mail.
- Review the backend terminal logs.
- Check spam/junk folders.
- Confirm the form owner email is the intended recipient.

### Google sign-in fails

- Confirm both Google client ID environment variables match.
- Confirm `http://localhost:5173` is an authorized JavaScript origin.
- Restart the frontend and backend after changing environment variables.
- Review the browser console and backend logs.

### `better-sqlite3` installation error

- Check `node --version`.
- Use a supported Node.js LTS release.
- Run `npm install` again from the project root.
- Consult the `better-sqlite3` installation documentation for platform-specific build requirements.

### Login stops working after some time

The app stores the JWT in local storage, but the token expires according to the backend's configured JWT lifetime. Log in again if the token has expired.

## Security notes

- Never commit `.env`, `frontend/.env`, database files, or SMTP credentials.
- Keep `JWT_SECRET` private and use a strong random value.
- If a secret is accidentally pushed to GitHub, rotate/revoke it. Removing the file in a later commit does not remove it from Git history.
- Do not put private backend credentials in `VITE_*` variables.
- Use HTTPS and production-specific origins when deploying.
- Local SQLite storage is suitable for local development and small deployments, but plan for backups and operational monitoring before using it for important production data.

## Development scripts

The commands depend on the `scripts` entries in the root and frontend `package.json` files. Common commands for this setup are:

```bash
# Backend, from project root
npm start

# Frontend, from project root
cd frontend
npm run dev
```

If these scripts are not defined, use the actual scripts in the checked-in package files or run `node server.js` for the backend entry point.

## License

Add a `LICENSE` file if you intend to distribute this project publicly. Until a license is added, do not assume others have permission to reuse or redistribute the code.
