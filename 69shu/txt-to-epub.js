// txt-to-epub.js
// Chuyển đổi các file txt trong một thư mục thành một file EPUB duy nhất

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const Epub = require('epub-gen');

async function convertToEpub(bookFolderPath, outputFileName) {
    if (!fs.existsSync(bookFolderPath)) {
        console.error(`Thư mục ${bookFolderPath} không tồn tại!`);
        return;
    }

    // Đọc thông tin sách từ thư mục
    const folderName = path.basename(bookFolderPath);
    console.log(`Đang chuyển đổi thư mục: ${folderName} thành EPUB...`);
      // Tìm tất cả file txt trong thư mục (dùng cwd để tương thích Windows)
    const files = glob.sync('chuong*.txt', { cwd: bookFolderPath })
        .map(f => path.join(bookFolderPath, f))
        .sort((a, b) => {
            // Sắp xếp file theo số chương
            const matchA = a.match(/chuong(\d+)\.txt/);
            const matchB = b.match(/chuong(\d+)\.txt/);
            if (!matchA || !matchB) return 0;
            const chapterNumA = parseInt(matchA[1]);
            const chapterNumB = parseInt(matchB[1]);
            return chapterNumA - chapterNumB;
        });

    if (files.length === 0) {
        console.error(`Không tìm thấy file txt nào trong thư mục ${bookFolderPath}`);
        return;
    }

    console.log(`Đã tìm thấy ${files.length} chương.`);

    // Đọc thông tin sách từ file đầu tiên (nếu có)
    let bookTitle = folderName;
    let author = "Không rõ tác giả";
    let description = "";
    
    // Kiểm tra xem có file metadata hoặc file sách đầy đủ không
    const bookFiles = glob.sync(path.join(bookFolderPath, '*.txt')).filter(file => !file.includes('chuong'));
    if (bookFiles.length > 0) {
        try {
            const bookContent = fs.readFileSync(bookFiles[0], 'utf8');
            const lines = bookContent.split('\n');
            if (lines.length > 0) bookTitle = lines[0].trim();
            
            // Tìm thông tin tác giả
            const authorLine = lines.find(line => line.includes('Author:') || line.includes('Tác giả:'));
            if (authorLine) {
                author = authorLine.split(':')[1].trim();
            }
            
            // Tìm thông tin giới thiệu
            const descLine = lines.find(line => line.includes('Description:') || line.includes('Giới thiệu:'));
            if (descLine) {
                description = descLine.split(':')[1].trim();
            }
        } catch (error) {
            console.warn(`Không đọc được thông tin từ file sách đầy đủ: ${error.message}`);
        }
    }

    // Tạo nội dung cho EPUB
    const chapters = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        
        // Dùng dòng đầu tiên làm tên chương
        let chapterTitle = lines[0];
        
        // Bỏ qua tên chương trong nội dung
        let chapterContent = lines.slice(1).join('\n').trim();
        
        // Thêm định dạng HTML cơ bản
        chapterContent = chapterContent
            .split('\n')
            .map(para => para.trim())
            .filter(para => para.length > 0)
            .map(para => `<p>${para}</p>`)
            .join('');
        
        chapters.push({
            title: chapterTitle,
            data: chapterContent
        });
        
        // Hiển thị tiến độ
        if ((i + 1) % 50 === 0 || i === files.length - 1) {
            console.log(`Đã xử lý ${i + 1}/${files.length} chương.`);
        }
    }

    // Tên file output
    const outputPath = outputFileName || path.join(path.dirname(bookFolderPath), `${bookTitle}.epub`);
    
    // Tùy chọn cho EPUB
    const options = {
        title: bookTitle,
        author: author,
        publisher: 'TVTruyen Downloader',
        cover: path.join(__dirname, 'cover.jpg'), // Sử dụng ảnh bìa nếu có
        lang: 'vi',
        tocTitle: 'Mục lục',
        appendChapterTitles: true,
        customHtmlTocTemplatePath: null,
        content: chapters
    };

    try {
        // Tạo file EPUB
        console.log(`Đang tạo file EPUB: ${outputPath}`);
        await new Epub(options, outputPath).promise;
        console.log(`Đã tạo thành công file EPUB: ${outputPath}`);
    } catch (error) {
        console.error(`Lỗi khi tạo EPUB: ${error.message}`);
    }
}

// Hàm tạo ảnh bìa đơn giản nếu không tìm thấy
function createCoverImage(title, outputPath) {
    // Đây là một hàm placeholder cho tính năng trong tương lai
    console.log("Chức năng tạo ảnh bìa chưa được triển khai.");
}

// Hàm chính để chạy từ dòng lệnh
async function main() {
    // Kiểm tra tham số dòng lệnh
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Cách sử dụng: node txt-to-epub.js <đường-dẫn-thư-mục-sách> [tên-file-output]');
        console.log('Ví dụ: node txt-to-epub.js "./downloaded_books/Thâu Hương Cao Thủ"');
        return;
    }
    
    const bookFolderPath = args[0];
    const outputFileName = args[1] || null;
    
    await convertToEpub(bookFolderPath, outputFileName);
}

// Nếu được gọi trực tiếp từ dòng lệnh
if (require.main === module) {
    main().catch(error => console.error(`Lỗi: ${error.message}`));
}

module.exports = { convertToEpub };
