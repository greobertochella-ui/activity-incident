"""
Generate password hashes for seeded users
"""
from auth import hash_password

passwords = [
    ("Admin2026!", "admin"),
    ("Jefe2026!", "jefe_general"),
    ("JefeA2026!", "jefe_a"),
    ("JefeB2026!", "jefe_b"),
    ("Carlos2026!", "carlos_ruiz"),
    ("Maria2026!", "maria_lopez"),
    ("Ana2026!", "ana_gomez"),
    ("Javier2026!", "javier_perez"),
]

print("Password hashes for database.py:")
print()
for pwd, username in passwords:
    try:
        hash_val = hash_password(pwd)
        print(f"-- {username}: {pwd}")
        print(f"'{hash_val}',")
    except Exception as e:
        print(f"Error hashing {username}: {e}")
