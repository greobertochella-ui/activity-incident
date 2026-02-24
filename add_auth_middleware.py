"""
Script to add current_user parameter to all protected API endpoints
"""
import re

with open('routes.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace pattern: add current_user before db parameter if not already present
# Pattern: ends with "db: aiosqlite.Connection = Depends(get_db))" 
# and doesn't already have current_user

def add_auth_param(match):
    """Add current_user parameter before db parameter"""
    full_match = match.group(0)
    
    # Skip if already has current_user or is auth/health endpoint
    if 'current_user' in full_match or '/auth/' in full_match or '/health' in full_match:
        return full_match
    
    # Find where to insert (before db parameter)
    # Replace "db: aiosqlite" with "current_user: dict = Depends(get_current_user),\n        db: aiosqlite"
    updated = re.sub(
        r'(\s+)(db: aiosqlite\.Connection = Depends\(get_db\))',
        r'\1current_user: dict = Depends(get_current_user),\n\1\2',
        full_match
    )
    
    return updated

# Pattern to match function definitions
# Matches from @api decorator through closing paren of parameters
pattern = r'@api\.(get|post|put|delete)\([^\)]+\)\s+async def \w+\([^\)]+\)'

# Apply replacements
updated_content = re.sub(pattern, add_auth_param, content, flags=re.MULTILINE | re.DOTALL)

# Count changes
original_count = content.count('current_user: dict = Depends(get_current_user)')
updated_count = updated_content.count('current_user: dict = Depends(get_current_user)')

print(f"Added current_user to {updated_count - original_count} endpoints")
print(f"Total endpoints with current_user: {updated_count}")

# Write back
with open('routes.py', 'w', encoding='utf-8') as f:
    f.write(updated_content)

print("✓ Updated routes.py")
