import { GetObjectCommand, PutObjectCommand, S3Client, } from '@aws-sdk/client-s3';
import { getSignedUrl, } from '@aws-sdk/s3-request-presigner';
const endpoint = process.env.AWS_ENDPOINT_URL_S3;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const region = process.env.AWS_REGION;
const bucket = process.env.AWS_S3_BUCKET;
if (!endpoint ||
    !accessKeyId ||
    !secretAccessKey ||
    !region ||
    !bucket) {
    throw new Error('Missing S3/Neon Object Storage configuration');
}
export const s3Client = new S3Client({
    endpoint,
    region,
    credentials: {
        accessKeyId,
        secretAccessKey,
    },
    forcePathStyle: true,
});
export const uploadPdf = async (key, pdfBuffer) => {
    await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
    }));
    return key;
};
export const createPdfDownloadUrl = async (key) => {
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: 'application/pdf',
        ResponseContentDisposition: `attachment; filename="${key
            .split('/')
            .pop()}"`,
    });
    return getSignedUrl(s3Client, command, {
        expiresIn: 300,
    });
};
