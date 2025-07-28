# Azure AD Teams Calling Setup Guide

## Error: AADSTS65001 - Admin Consent Required

You're seeing this error because the Azure AD application doesn't have the necessary permissions for Teams calling. Here's how to fix it:

## 🔧 **Step-by-Step Solution**

### **Option 1: Grant Admin Consent (Recommended)**

1. **Go to Azure Portal**

   - Navigate to [portal.azure.com](https://portal.azure.com)
   - Sign in with your admin account

2. **Find Your App Registration**

   - Go to **Azure Active Directory** → **App registrations**
   - Search for: `Teams Meeting App`
   - Or use the App ID: `e03ab8e9-4eb4-4bbc-8c6d-805021e089cd`

3. **Add API Permissions**

   - Click on your app registration
   - Go to **API permissions** tab
   - Click **Add a permission**
   - Select **Microsoft Graph**
   - Choose **Application permissions**
   - Add these permissions:
     - `Calls.InitiateOutgoingCall`
     - `Calls.JoinGroupCall.All`
     - `Calls.AccessMedia.All`
     - `Calls.InitiateGroupCall.All`

4. **Grant Admin Consent**
   - Click **Grant admin consent for [Your Organization]**
   - Confirm the action

### **Option 2: Use Delegated Permissions (Alternative)**

If you prefer delegated permissions instead of application permissions:

1. **Add Delegated Permissions**

   - In API permissions, select **Delegated permissions**
   - Add the same calling permissions:
     - `Calls.InitiateOutgoingCall`
     - `Calls.JoinGroupCall.All`
     - `Calls.AccessMedia.All`
     - `Calls.InitiateGroupCall.All`

2. **User Consent**
   - Users will be prompted to consent when they first try to make a call
   - Or grant admin consent to skip user prompts

## 🚨 **Important Notes**

### **Permission Types**

- **Application Permissions**: Work for all users, require admin consent
- **Delegated Permissions**: Work per user, can have user consent

### **Teams License Requirements**

- Users must have Microsoft Teams licenses
- Teams calling plan may be required for external calls

### **Browser Requirements**

- HTTPS connection required
- Microphone/camera permissions for video calls
- Modern browser with WebRTC support

## 🔍 **Troubleshooting**

### **Still Getting Consent Errors?**

1. **Check App Registration**

   ```bash
   # Verify your app ID matches
   App ID: e03ab8e9-4eb4-4bbc-8c6d-805021e089cd
   ```

2. **Clear Browser Cache**

   - Clear MSAL cache in browser
   - Sign out and sign back in

3. **Check Token Scopes**
   - Open browser dev tools
   - Check Network tab for token requests
   - Verify calling scopes are included

### **Common Issues**

1. **"Permission not found"**

   - Ensure you're using Microsoft Graph (not Azure AD Graph)
   - Check that permissions are spelled correctly

2. **"Admin consent failed"**

   - Verify you have Global Administrator or Application Administrator role
   - Try granting consent for individual permissions

3. **"User not found"**
   - Ensure target users have valid Teams accounts
   - Check user IDs in the Teams contact list

## 📋 **Quick Fix Script**

If you have PowerShell access, you can run this script:

```powershell
# Connect to Azure AD
Connect-AzureAD

# Get your app registration
$app = Get-AzureADApplication -Filter "AppId eq 'e03ab8e9-4eb4-4bbc-8c6d-805021e089cd'"

# Add Microsoft Graph permissions
$graphAppId = "00000003-0000-0000-c000-000000000000"
$graphServicePrincipal = Get-AzureADServicePrincipal -Filter "AppId eq '$graphAppId'"

# Define required permissions
$permissions = @(
    "Calls.InitiateOutgoingCall",
    "Calls.JoinGroupCall.All",
    "Calls.AccessMedia.All",
    "Calls.InitiateGroupCall.All"
)

# Add each permission
foreach ($permission in $permissions) {
    $appPermission = $graphServicePrincipal.AppRoles | Where-Object {$_.Value -eq $permission}
    New-AzureADApplicationAppRoleAssignment -ObjectId $app.ObjectId -PrincipalId $app.ObjectId -ResourceId $graphServicePrincipal.ObjectId -Id $appPermission.Id
}

Write-Host "Permissions added successfully!"
```

## 🎯 **Testing the Fix**

1. **Clear Application Cache**

   - Sign out of the application
   - Clear browser cache and cookies
   - Sign back in

2. **Test Calling**

   - Try initiating an audio call
   - Check browser console for any remaining errors
   - Verify call controls appear in the UI

3. **Monitor Logs**
   - Check browser console for successful token acquisition
   - Verify calling API calls are successful

## 📞 **Support**

If you continue to have issues:

1. **Check Azure AD Audit Logs**

   - Go to Azure AD → Audit logs
   - Filter by your app registration
   - Look for consent events

2. **Contact Your IT Administrator**

   - Provide them with this guide
   - Share the specific error message
   - Include your app registration details

3. **Microsoft Support**
   - If using Microsoft 365, contact Microsoft support
   - Provide the correlation ID from the error message

## ✅ **Success Indicators**

When properly configured, you should see:

- ✅ No consent errors in browser console
- ✅ Call buttons appear in Teams interface
- ✅ Successful call initiation
- ✅ Call controls (mute, end call) work properly
- ✅ Call status indicators display correctly

---

**Note**: This setup requires administrative access to Azure AD. If you don't have admin rights, contact your IT administrator with these instructions.
