// TVTruyen Book Downloader

// Add necessary modules for file system operations and HTML parsing
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // You may need to run: npm install node-fetch@2
const cheerio = require('cheerio');  // You may need to run: npm install cheerio

// Base URL from the extension
const BASE_URL = "https://www.tvtruyen.com";

// Function to get book details
async function getBookDetails(url) {
    console.log("Fetching book details from:", url);
    try {
        let response = await fetch(url);
        if (response.ok) {
            let html = await response.text();
            let $ = cheerio.load(html);

            // Extract book details using cheerio selectors
            let name = $("h3.title#comic_name").text().trim();
            let cover = $(".book img").attr("src");
            let author = $(".author a.item-value").text().trim();
            let description = $("section.limit-desc").text().trim();
            let ongoing = $(".info .item-value.text-success").text().indexOf("Full") === -1;

            return { name, cover, author, description, ongoing };
        }
    } catch (error) {
        console.error("Error fetching book details:", error);
    }
    return null;
}

// Function to get all chapters
async function getAllChapters(url) {
    console.log("Fetching chapters from:", url);
    let allChapters = [];
    let currentPage = 1;
    let hasNext = true;

    while (hasNext) {
        try {
            let pageUrl = url + "?page=" + currentPage + "#list-chapter";
            let response = await fetch(pageUrl);
            
            if (!response.ok) break;

            let html = await response.text();
            let $ = cheerio.load(html);
            
            // Extract chapters
            $(".list-chapter li a").each((index, element) => {
                allChapters.push({
                    name: $(element).find(".chapter-text-all").text().trim(),
                    url: $(element).attr("href")
                });
            });

            // Check for next page
            let nextLink = $('a[rel="next"]');
            if (nextLink.length > 0) {
                currentPage++;
            } else {
                hasNext = false;
            }
        } catch (error) {
            console.error(`Error fetching chapters page ${currentPage}:`, error);
            hasNext = false;
        }
    }

    return allChapters;
}

// Function to get chapter content
async function getChapterContent(url) {
    console.log("Fetching chapter content from:", url);
    
    try {
        // Logic based on chap.js
        // First, transform the URL from TVTruyen format to CDN format
        url = url.replace("https://www.tvtruyen.com/", "https://cdn.cscldsck.com/chapters/");
        url = url.replace("https://cdn.cscldsck.com/chapters/", "https://cdn-2.cscldsck.com/chapters/");
        
        // Try the primary CDN
        let response = await fetch(url, {
            headers: {
                "referer": "https://www.tvtruyen.com/",
            }
        });
        
        // Fallback to the secondary CDN if needed
        if (!response.ok) {
            url = url.replace("https://cdn-2.cscldsck.com/chapters/", "https://cdn.cscldsck.com/chapters/");
            response = await fetch(url, {
                headers: {
                    "referer": "https://www.tvtruyen.com/",
                }
            });
        }
        
        if (response.ok) {
            let html = await response.text();
            let $ = cheerio.load(html);
            
            // Remove unwanted elements
            $("h1, h2, h3").remove();
            
            return $.html();
        }
    } catch (error) {
        console.error("Error fetching chapter content:", error);
    }
    
    return "Không thể tải nội dung chương. Vui lòng thử lại sau.";
}

// Main download function
async function downloadBook(bookUrl, concurrentDownloads = 5) {
    // Get book details
    const bookDetails = await getBookDetails(bookUrl);
    if (!bookDetails) {
        console.error("Could not fetch book details");
        return;
    }
    
    console.log(`Downloading book: ${bookDetails.name} by ${bookDetails.author}`);
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'downloaded_books');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Create book-specific folder
    const bookDir = path.join(outputDir, sanitizeFilename(bookDetails.name));
    if (!fs.existsSync(bookDir)) {
        fs.mkdirSync(bookDir, { recursive: true });
    }
    
    // Get all chapters
    const chapters = await getAllChapters(bookUrl);
    console.log(`Found ${chapters.length} chapters`);
    
    // Create book content
    let bookContent = `${bookDetails.name}\n\n`;
    bookContent += `Author: ${bookDetails.author}\n\n`;
    bookContent += `Description: ${bookDetails.description}\n\n`;
    bookContent += `Status: ${bookDetails.ongoing ? 'Đang tiếp tục' : 'Hoàn thành'}\n\n`;
    bookContent += `Downloaded from: ${bookUrl}\n\n`;
    bookContent += `---------------------------------------\n\n`;
    
    // Chia danh sách chương thành các nhóm nhỏ để tải song song
    const chapterChunks = chunkArray(chapters, concurrentDownloads);
    
    // Tải từng nhóm song song
    for (let chunkIndex = 0; chunkIndex < chapterChunks.length; chunkIndex++) {
        const chapterChunk = chapterChunks[chunkIndex];
        console.log(`Downloading chunk ${chunkIndex + 1}/${chapterChunks.length} (${chapterChunk.length} chapters)`);
        
        // Tạo mảng các promise để tải các chương trong nhóm hiện tại
        const chapterPromises = chapterChunk.map(async (chapter, indexInChunk) => {
            const globalIndex = chunkIndex * concurrentDownloads + indexInChunk;
            console.log(`Starting download chapter ${globalIndex + 1}/${chapters.length}: ${chapter.name}`);
            
            // Get and add chapter content
            const content = await getChapterContent(chapter.url);
            const plainTextContent = extractTextFromHtml(content);
            
            // Save individual chapter
            const chapterFileName = `chuong${globalIndex + 1}.txt`;
            const chapterContent = `${chapter.name}\n\n${plainTextContent}`;
            saveToFile(path.join(bookDir, chapterFileName), chapterContent);
            
            console.log(`Completed chapter ${globalIndex + 1}/${chapters.length}: ${chapter.name}`);
            
            // Return data needed for the full book content
            return {
                name: chapter.name,
                content: plainTextContent,
                index: globalIndex
            };
        });
        
        // Chờ tất cả các chương trong nhóm hiện tại hoàn thành
        const chapterResults = await Promise.all(chapterPromises);
        
        // Thêm nội dung các chương vào nội dung sách chính
        for (const result of chapterResults) {
            bookContent += `${result.name}\n`;
            bookContent += `---------------------------------------\n\n`;
            bookContent += result.content + "\n\n";
        }
        
        // Thêm một khoảng thời gian ngắn giữa các nhóm để giảm áp lực cho máy chủ
        if (chunkIndex < chapterChunks.length - 1) {
            console.log(`Waiting briefly before downloading next chunk...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    // Save the complete book
    saveToFile(path.join(bookDir, `${sanitizeFilename(bookDetails.name)}.txt`), bookContent);
    console.log(`Book "${bookDetails.name}" has been downloaded successfully to ${bookDir}!`);
}

// Helper function to extract text from HTML
function extractTextFromHtml(html) {
    const $ = cheerio.load(html);
    // Convert <br> to newlines
    $('br').replaceWith('\n');
    // Get text content
    let text = $.text();

    // Clean up the text: đảm bảo chỉ có 1 dòng trống giữa các đoạn
    return text
        .replace(/\r/g, '') // Xóa ký tự xuống dòng kiểu cũ
        .replace(/\n+/g, '\n') // Gộp nhiều dòng trống thành 1 dòng
        .replace(/[ \t]+\n/g, '\n') // Xóa khoảng trắng cuối dòng
        .replace(/\n[ \t]+/g, '\n') // Xóa khoảng trắng đầu dòng
        .trim();
}

// Helper function to sanitize filenames
function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
}

// Helper function to save content to a file
function saveToFile(filename, content) {
    try {
        fs.writeFileSync(filename, content, 'utf8');
        console.log(`Saved file: ${filename}`);
    } catch (error) {
        console.error(`Error saving file ${filename}:`, error);
    }
}

// Helper function to chunk an array into smaller arrays
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// Example usage:
// downloadBook("https://www.tvtruyen.com/truyen/example-book");

// If run directly from command line
if (require.main === module) {
    const url = process.argv[2];
    const concurrentDownloads = parseInt(process.argv[3]) || 5; // Mặc định là 5 nếu không chỉ định
    
    if (url) {
        console.log(`Starting download with ${concurrentDownloads} concurrent downloads...`);
        downloadBook(url, concurrentDownloads).catch(err => console.error('Error downloading book:', err));
    } else {
        console.log('Usage: node TVTruyen-downloader.js <book-url> [concurrent-downloads]');
        console.log('Example: node TVTruyen-downloader.js https://www.tvtruyen.com/truyen/example-book 10');
        console.log('Default concurrent downloads: 5');
    }
}
