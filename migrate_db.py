from app import app, db
from sqlalchemy import text

def migrate():
    with app.app_context():
        # Check if column exists
        with db.engine.connect() as conn:
            result = conn.execute(text("PRAGMA table_info(expense)"))
            columns = [row[1] for row in result]
            
            if 'is_bank_visible' not in columns:
                print("Adding is_bank_visible column to expense table...")
                try:
                    conn.execute(text("ALTER TABLE expense ADD COLUMN is_bank_visible BOOLEAN DEFAULT 1"))
                    conn.execute(text("UPDATE expense SET is_bank_visible = 1"))
                    conn.commit()
                    print("Migration successful!")
                except Exception as e:
                    print(f"Migration failed: {e}")
            else:
                print("Column is_bank_visible already exists.")

if __name__ == '__main__':
    migrate()
