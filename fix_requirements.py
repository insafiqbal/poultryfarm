
import os

def clean_file():
    try:
        # Read as binary to handle any BOM or weird encoding
        with open('requirements.txt', 'rb') as f:
            content = f.read()
        
        # Try decoding as utf-16-le (common source of \x00 padding for ASCII chars)
        try:
            text = content.decode('utf-16')
        except:
            # Fallback to utf-8, ignoring errors or replacing
            try:
                text = content.decode('utf-8')
            except:
                text = content.decode('latin-1')

        # Clean up the text
        lines = text.splitlines()
        clean_lines = []
        for line in lines:
            # Remove null bytes if any remain (though decoding should have handled it if matched)
            line = line.replace('\x00', '')
            clean = line.strip()
            if clean:
                clean_lines.append(clean)
        
        # Ensure gunicorn is present
        if 'gunicorn' not in clean_lines:
            clean_lines.append('gunicorn')
            
        # Write back as pure UTF-8
        with open('requirements.txt', 'w', encoding='utf-8') as f:
            f.write('\n'.join(clean_lines))
            f.write('\n')
            
        print("Successfully cleaned requirements.txt and saved as UTF-8")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    clean_file()
