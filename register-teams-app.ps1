# PowerShell script to register Azure AD app with Microsoft Teams
# Run this script with admin privileges

param(
    [Parameter(Mandatory=$true)]
    [string]$AppId,
    
    [Parameter(Mandatory=$true)]
    [string]$TenantId
)

Write-Host "Registering Azure AD app with Microsoft Teams..." -ForegroundColor Green

# Install Microsoft Graph PowerShell module if not installed
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph)) {
    Write-Host "Installing Microsoft.Graph PowerShell module..." -ForegroundColor Yellow
    Install-Module -Name Microsoft.Graph -Force -AllowClobber
}

# Connect to Microsoft Graph
Write-Host "Connecting to Microsoft Graph..." -ForegroundColor Yellow
Connect-MgGraph -Scopes "Application.ReadWrite.All", "AppRoleAssignment.ReadWrite.All"

# Get the application
$app = Get-MgApplication -Filter "appId eq '$AppId'"

if (-not $app) {
    Write-Host "Error: Application with AppId $AppId not found!" -ForegroundColor Red
    exit 1
}

Write-Host "Found application: $($app.DisplayName)" -ForegroundColor Green

# Create Teams app manifest
$teamsAppManifest = @{
    "$schema" = "https://developer.microsoft.com/en-us/json-schemas/teams/v1.14/MicrosoftTeams.schema.json"
    "manifestVersion" = "1.14"
    "version" = "1.0.0"
    "id" = $app.Id
    "packageName" = "com.microsoft.teams.$($app.DisplayName.ToLower().Replace(' ', ''))"
    "developer" = @{
        "name" = "Your Organization"
        "websiteUrl" = "https://yourwebsite.com"
        "privacyUrl" = "https://yourwebsite.com/privacy"
        "termsOfUseUrl" = "https://yourwebsite.com/terms"
    }
    "name" = @{
        "short" = $app.DisplayName
        "full" = $app.DisplayName
    }
    "description" = @{
        "short" = "Teams calling application"
        "full" = "Application for Teams calling functionality"
    }
    "icons" = @{
        "outline" = "https://yourwebsite.com/icon-outline.png"
        "color" = "https://yourwebsite.com/icon-color.png"
    }
    "accentColor" = "#FFFFFF"
    "configurableTabs" = @()
    "staticTabs" = @()
    "bots" = @()
    "connectors" = @()
    "composeExtensions" = @()
    "permissions" = @(
        "identity",
        "messageTeamMembers"
    )
    "validDomains" = @(
        "yourwebsite.com"
    )
    "webApplicationInfo" = @{
        "id" = $AppId
        "resource" = "https://graph.microsoft.com"
    }
}

# Save manifest to file
$manifestPath = "teams-app-manifest.json"
$teamsAppManifest | ConvertTo-Json -Depth 10 | Out-File -FilePath $manifestPath -Encoding UTF8

Write-Host "Teams app manifest saved to: $manifestPath" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Upload this manifest to Microsoft Teams Admin Center" -ForegroundColor White
Write-Host "2. Or use Teams Toolkit to deploy the app" -ForegroundColor White
Write-Host "3. Grant admin consent for the calling permissions" -ForegroundColor White

Write-Host "App registration script completed!" -ForegroundColor Green 