## 👥 Create Organization Setup (45 minutes)

Allow users to create/join organizations.

### Add Organization Management to Profile Tab

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

### Add Organization Creation API

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

## 📊 Test Everything

### Test Checklist

- [ ] Create organization
- [ ] Check profile data in Supabase

---

## 📝 Notes

- **UX tip:** Show loading states during auth operations
- **Testing tip:** Use temp-mail.org for testing email flows
