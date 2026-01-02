from app import app, db
from sqlalchemy import text

def add_is_bank_visible():
    with app.app_context():
        try:
            # Check if column exists
            with db.engine.connect() as conn:
                try:
                    result = conn.execute(text("SELECT is_bank_visible FROM expense LIMIT 1"))
                    print("Column 'is_bank_visible' already exists.")
                    return
                except:
                    # Column doesn't exist, so add it
                    print("Adding 'is_bank_visible' column...")
                    conn.execute(text("ALTER TABLE expense ADD COLUMN is_bank_visible BOOLEAN DEFAULT 1"))
                    conn.execute(text("UPDATE expense SET is_bank_visible = 1"))
                    conn.commit()
                    print("Migration successful! Column added.")
        except Exception as e:
            print(f"Error during migration: {e}")

if __name__ == '__main__':
    add_is_bank_visible()
