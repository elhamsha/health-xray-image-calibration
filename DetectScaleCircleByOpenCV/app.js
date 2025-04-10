let originalImage = null;
let isImageLoaded = false;

// Configuration for detection
const config = {
    whiteThreshold: 200,
    circleMinArea: 100,
    circleMaxArea: 5000,
    circularityThreshold: 0.7,
    lineMinLength: 50,
    lineMaxWidth: 30,
    lineSearchRadius: 100  // Search radius around circle for line
};

// Define a DPI value (you can adjust this based on your requirements)
const DPI = 96; // Example DPI value, adjust as necessary

// Initialize UI elements
const fileInput = document.getElementById('fileInput');
const detectButton = document.getElementById('detectButton');
const imageCanvas = document.getElementById('imageCanvas');
const debugCanvas = document.getElementById('debugCanvas');

// File input handler
fileInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
            originalImage = new Image();
            originalImage.onload = function() {
                displayOriginalImage(originalImage);
                isImageLoaded = true;
                detectButton.disabled = false;
            };
            originalImage.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// Detect button handler
detectButton.addEventListener('click', function() {
    if (originalImage) {
        processImage(originalImage);
    }
});

function displayOriginalImage(image) {
    // Set canvas sizes
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    debugCanvas.width = image.width;
    debugCanvas.height = image.height;

    // Draw original image
    const ctx = imageCanvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    // Clear debug canvas
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

    // Update status
    document.getElementById('measurementsInfo').innerHTML = 
        '<h3>Status:</h3><p class="info-text">Image loaded. Click "Detect & Calibrate" to process.</p>';
}

function processImage(image) {
    try {
        // Create OpenCV matrices
        const src = cv.imread(imageCanvas);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // Create ROI for right side of image
        const rightSideWidth = Math.floor(src.cols * 0.3);
        const roiX = src.cols - rightSideWidth;
        
        // Create debug visualization
        const debugMat = src.clone();
        
        // Draw ROI area
        cv.rectangle(debugMat, 
            new cv.Point(roiX, 0),
            new cv.Point(src.cols, src.rows),
            [255, 255, 0, 128],
            2
        );

        // Enhanced thresholding
        const binary = new cv.Mat();
        const blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0);
        cv.threshold(blurred, binary, config.whiteThreshold, 255, cv.THRESH_BINARY);

        // Morphological operations
        const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
        const cleaned = new cv.Mat();
        cv.morphologyEx(binary, cleaned, cv.MORPH_CLOSE, kernel);
        cv.morphologyEx(cleaned, cleaned, cv.MORPH_OPEN, kernel);

        // Find contours
        const roi = cleaned.roi(new cv.Rect(roiX, 0, rightSideWidth, src.rows));
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(roi, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let circleFound = null;

        // Find circle
        for (let i = 0; i < contours.size(); ++i) {
            const contour = contours.get(i);
            const area = cv.contourArea(contour);
            const perimeter = cv.arcLength(contour, true);
            const circularity = 4 * Math.PI * area / (perimeter * perimeter);
            const rect = cv.boundingRect(contour);

            rect.x += roiX;

            if (!circleFound && 
                area >= config.circleMinArea && 
                area <= config.circleMaxArea && 
                circularity > config.circularityThreshold) {
                
                const center = {
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2
                };
                const radius = Math.sqrt(area / Math.PI);

                circleFound = { center, radius, rect };
                console.log("Circle detected:", { 
                    x: center.x, 
                    y: center.y, 
                    radius, 
                    circularity, 
                    area 
                });
            }
        }

        // Draw detections
        if (circleFound) {
            drawCircle(debugMat, circleFound);
        }

        // Show results on debug canvas
        cv.imshow('debugCanvas', cleaned);

        // Apply scaling if circle is found
        if (circleFound) {
            const circleDiameter = circleFound.radius * 2; // Diameter in pixels
            const scaleFromCircle = (10 * DPI) / (circleDiameter * 25.4); // Scale factor based on the circle's diameter in mm (10 cm = 100 mm)

            // Create a new canvas for the scaled image
            const scaledMat = applyScaling(debugMat, scaleFromCircle); // Scale the entire image
            cv.imshow('imageCanvas', scaledMat); // Show scaled image
            scaledMat.delete();
        } else {
            cv.imshow('imageCanvas', debugMat); // Show original debug image if no circle found
        }

        // Update status
        updateStatus(circleFound, null);

        // Cleanup
        src.delete();
        gray.delete();
        binary.delete();
        blurred.delete();
        cleaned.delete();
        kernel.delete();
        roi.delete();
        contours.delete();
        hierarchy.delete();
        debugMat.delete();

    } catch (err) {
        console.error('Error processing image:', err);
        document.getElementById('measurementsInfo').innerHTML = 
            `<p class="error">Error processing image: ${err.message}</p>`;
    }
}

function drawCircle(mat, circle) {
    // Draw circle
    cv.circle(mat, 
        new cv.Point(circle.center.x, circle.center.y),
        circle.radius,
        [255, 0, 0, 255],
        3
    );

    // Draw center
    cv.circle(mat,
        new cv.Point(circle.center.x, circle.center.y),
        5,
        [255, 0, 0, 255],
        -1
    );

    // Draw diameter line
    const startX = circle.center.x - circle.radius;
    const endX = circle.center.x + circle.radius;
    cv.line(mat,
        new cv.Point(startX, circle.center.y),
        new cv.Point(endX, circle.center.y),
        [255, 0, 0, 255],
        2
    );

    // Draw measurement
    drawMeasurementText(mat,
        `Circle: ${(circle.radius * 2).toFixed(1)}px (17mm)`,
        0, -40, // Offset from center
        [255, 0, 0, 255]
    );
}

function drawMeasurementText(mat, text, x, y, color) {
    const padding = 5;
    const textWidth = text.length * 11;
    const textHeight = 24;

    // Position text in middle-left of image
    const textX = 10; // Left margin
    const textY = Math.floor(mat.rows / 2) + y; // Center vertically

    // Draw white background with rounded corners
    cv.rectangle(mat,
        new cv.Point(textX - padding, textY - textHeight - padding),
        new cv.Point(textX + textWidth + padding, textY + padding),
        [255, 255, 255, 200],
        -1
    );

    // Draw text
    cv.putText(
        mat,
        text,
        new cv.Point(textX, textY),
        cv.FONT_HERSHEY_SIMPLEX,
        0.8,
        color,
        2
    );
}

function applyScaling(mat, scale) {
    const scaledWidth = Math.floor(mat.cols * scale);
    const scaledHeight = Math.floor(mat.rows * scale);
    
    const scaledMat = new cv.Mat();
    cv.resize(mat, scaledMat, new cv.Size(scaledWidth, scaledHeight), 0, 0, cv.INTER_LINEAR);
    
    return scaledMat;
}

function updateStatus(circleFound, lineFound) {
    const statusDiv = document.getElementById('measurementsInfo');
    let html = '<h3>Detection Status:</h3>';
    
    if (circleFound) {
        html += `<p class="success">✓ White circle detected (${(circleFound.radius * 2).toFixed(1)}px diameter)</p>`;
    } else {
        html += '<p class="error">✗ No white circle detected</p>';
    }

    if (circleFound) {
        const circleDiameter = circleFound.radius * 2;
        const scaleFromCircle = (10 * DPI) / (circleDiameter * 25.4);
        const averageScale = scaleFromCircle;
        html += `<p class="info-text">Scale factor: ${averageScale.toFixed(3)} mm/pixel</p>`;
    }

    statusDiv.innerHTML = html;
}