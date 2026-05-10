# Code Signing Setup Guide

Code signing is a security mechanism that verifies the authenticity of your application. When you sign your app, it proves to users that it comes from you and hasn't been tampered with.

## Overview

This project uses **Electron Forge** to handle code signing for Windows only:

- **Windows**: Signs executables with a code signing certificate (PFX)

## Windows Code Signing

### Step 1: Obtain a Code Signing Certificate

1. Purchase a certificate from a trusted Certificate Authority (CA):
   - **DigiCert** (enterprise-friendly, most common)
   - **Sectigo** (affordable)
   - **GlobalSign** (high-assurance)
   - **Entrust** (another reputable option)

2. The certificate will come as a `.pfx` file (contains both private key + certificate)

3. Keep this file **secure** and **never commit it to Git**

### Step 2: Set Up Environment Variables

1. Copy `.env.example` to `.env.local` (git-ignored):

   ```bash
   cp .env.example .env.local
   ```

2. Fill in your Windows values:
   ```env
   WINDOWS_CERTIFICATE_FILE=C:\path\to\your\cert.pfx
   WINDOWS_CERTIFICATE_PASSWORD=your_password_here
   WINDOWS_TIMESTAMP_SERVER=http://timestamp.digicert.com
   ```

### Step 3: Build & Sign

When you run `npm run make`, Electron Forge will:

- Detect the environment variables
- Load your certificate
- Sign the Windows installer and portable exe
- Add a timestamp (so signature stays valid even after cert expires)

## For CI/CD (GitHub Actions)

If you want to auto-sign releases in GitHub Actions:

1. **Encode your certificate as base64**:

   ```bash
   base64 -i your-cert.pfx -o cert.pfx.b64
   ```

2. **Add GitHub Secrets**:
   - `WINDOWS_CERTIFICATE_FILE` (base64 of your .pfx)
   - `WINDOWS_CERTIFICATE_PASSWORD`
   - `WINDOWS_TIMESTAMP_SERVER`

3. **In your GitHub Actions workflow**:
   ```yaml
   - name: Set up code signing
     env:
       WINDOWS_CERTIFICATE_FILE: ${{ secrets.WINDOWS_CERTIFICATE_FILE }}
       WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
       WINDOWS_TIMESTAMP_SERVER: ${{ secrets.WINDOWS_TIMESTAMP_SERVER }}
   ```

## Local Development

**You don't need to sign during development!** The code in `forge.config.ts` only signs if the environment variables are present. Leave `.env.local` empty for local builds.

## Troubleshooting

### Windows

- **"Invalid certificate"**: Verify the PFX file path and password
- **"Timestamp server unreachable"**: Try a different timestamping server
- **"Certificate expired"**: Renew your certificate and update the PFX file

## Security Best Practices

1. **Never commit** `.env.local` or certificate files to Git
2. **Use strong passwords** for your certificates
3. **Rotate certificates** periodically (annually recommended)
4. **Keep backups** of your PFX file in a secure location
5. **Use GitHub Secrets** for CI/CD, not plaintext environment variables
