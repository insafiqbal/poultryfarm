
try:
    with open('requirements.txt', 'r', encoding='utf-16') as f:
        lines = f.readlines()
except UnicodeError:
    with open('requirements.txt', 'r', encoding='utf-8') as f:
        lines = f.readlines()
except Exception as e:
    print(f"Error reading: {e}")
    lines = []

with open('requirements.txt', 'w', encoding='utf-8') as f:
    for line in lines:
        if 'pywin32' not in line:
            f.write(line)
print("Cleaned requirements.txt")
