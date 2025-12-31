# Deploying Saudi Farms Manager to Render

## Prerequisites
- A GitHub account.
- A Render.com account.
- Git installed locally.

## Step 1: Push Code to GitHub
1. Initialize Git (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Prepare for deployment"
   ```
2. Create a new repository on GitHub.
3. Link and push your code:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

## Step 2: Create a Database on Render
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **PostgreSQL**.
3. Name: `saudi-farms-db`.
4. Plan: **Free**.
5. Click **Create Database**.
6. **Copy the "Internal Database URL"**. You will need this shortly.

## Step 3: Create the Web Service
1. Go back to Render Dashboard.
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository.
4. Settings:
   - **Name**: `saudi-farms-app`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`
5. **Environment Variables** (Click "Advanced"):
   - Key: `DATABASE_URL` | Value: (Paste the Internal Database URL from Step 2)
   - Key: `SECRET_KEY`   | Value: (Create a random long string, e.g., `s3cr3t_k3y_12345`)
   - Key: `SMTP_PASSWORD`| Value: (Your Gmail App Password)
   - Key: `SMTP_EMAIL`   | Value: `poultryfarms25@gmail.com`
   - Key: `PYTHON_VERSION`| Value: `3.9.0`
6. Click **Create Web Service**.

## Step 4: Initialize the Database
1. Wait for the deploy to finish (it might fail initially because tables don't exist).
2. Go to the **Shell** tab on your Web Service page in Render.
3. Run this command to create tables and seed the user:
   ```bash
   python init_db.py
   ```
   *Expected Output: `✅ Tables created successfully`, `✅ Seeded default user...`*

## Step 5: Verify
1. Click the URL provided by Render (e.g., `https://saudi-farms-app.onrender.com`).
2. Log in with:
   - **Email**: `insafiqbal2004@gmail.com`
   - **Password**: `insaf123`

## Troubleshooting
- **Logs**: Check the "Logs" tab in Render for any errors.
- **Database**: Ensure `DATABASE_URL` is correct and starts with `postgres://` (Render usually handles this).
