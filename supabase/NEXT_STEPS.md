## 👥 Step 4: Create Organization Setup (45 minutes)

Allow users to create/join organizations.

### 4.1 Add Organization Management to Profile Tab

In `profileTab.ts`, add organization section:

```typescript
// Add this to your profile display
const orgSection = document.createElement("div");
orgSection.className = "org-section";
orgSection.innerHTML = `
  <h3>Organization</h3>
  ${
    user.org_id
      ? `<p>Current: ${orgName}</p>
       <button id="leaveOrgBtn">Leave Organization</button>`
      : `<button id="createOrgBtn">Create Organization</button>
       <button id="joinOrgBtn">Join Organization</button>`
  }
`;
```

### 4.2 Add Organization Creation API

Create `src/supabase/organizations.ts`:

```typescript
import { supabase } from "./config";

export async function createOrganization(name: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Create organization
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name })
    .select()
    .single();

  if (orgError) throw orgError;

  // Update user profile with org_id
  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({ org_id: org.id })
    .eq("id", user.id);

  if (updateError) throw updateError;

  return org;
}

export async function getOrganization(orgId: string) {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();

  if (error) throw error;
  return data;
}

export async function joinOrganization(orgId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_profiles")
    .update({ org_id: orgId })
    .eq("id", user.id);

  if (error) throw error;
}
```

---

## 🔐 Step 5: Optional OAuth Providers (20 minutes each)

Add social login options.

### 5.1 Enable GitHub OAuth

1. Go to **Authentication** → **Providers** → **GitHub**
2. Toggle **Enable Sign in with GitHub**
3. Create GitHub OAuth App:
   - Go to https://github.com/settings/developers
   - Click **New OAuth App**
   - Application name: `Dev Time Tracker`
   - Homepage URL: `http://localhost:3000`
   - Callback URL: Copy from Supabase (looks like `https://xxx.supabase.co/auth/v1/callback`)
4. Copy **Client ID** and **Client Secret** to Supabase
5. Save

### 5.2 Add GitHub Button to Login UI

```typescript
// In LandingPage.ts
async function signInWithGitHub() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "github",
  });
  if (error) {
    showInAppNotification(`Error: ${error.message}`);
  }
}

// Add button in auth modal
const githubBtn = document.createElement("button");
githubBtn.textContent = "🐙 Continue with GitHub";
githubBtn.onclick = signInWithGitHub;
```

### 5.3 Enable Google OAuth (Similar process)

1. Go to **Authentication** → **Providers** → **Google**
2. Create Google OAuth credentials at https://console.cloud.google.com
3. Add credentials to Supabase
4. Add button to UI

---

## 📊 Step 6: Test Everything (15 minutes)

### 6.1 Test Checklist

- [ ] Sign up with new email
- [ ] Check if confirmation email received (if enabled)
- [ ] Confirm email via link
- [ ] Log in with credentials
- [ ] Request password reset
- [ ] Check reset email received
- [ ] Reset password via link
- [ ] Log in with new password
- [ ] Create organization
- [ ] Log out properly
- [ ] Check profile data in Supabase

### 6.2 Troubleshooting

**Email not received?**

- Check Supabase → Authentication → Logs
- Check spam folder
- Verify email template has `{{ .ConfirmationURL }}`

**Reset password not working?**

- Check if redirectTo URL is correct
- Verify password meets requirements
- Check browser console for errors

---

## 🎯 Priority Order

**Immediate (Today):**

1. ✅ Configure email templates (15 min)
2. ✅ Adjust authentication settings (10 min)
3. ✅ Test signup/login flow (10 min)

**This Week:** 4. 🔄 Implement password reset (30 min) 5. 🔄 Add organization creation (45 min) 6. 🔄 Test all auth flows (15 min)

**Optional (Later):** 7. ⏸️ OAuth providers (20 min each) 8. ⏸️ Email change flow 9. ⏸️ Two-factor authentication

---

## 📝 Notes

- **Development tip:** Disable email confirmation for testing, enable for production
- **Security tip:** Always use HTTPS in production for redirectTo URLs
- **UX tip:** Show loading states during auth operations
- **Testing tip:** Use temp-mail.org for testing email flows

---

## 🆘 Need Help?

- **Supabase Docs:** https://supabase.com/docs/guides/auth
- **Email Templates:** https://supabase.com/docs/guides/auth/auth-email-templates
- **OAuth Setup:** https://supabase.com/docs/guides/auth/social-login
