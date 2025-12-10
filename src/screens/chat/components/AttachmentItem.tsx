import React from 'react';
import { TouchableOpacity, Image, View, Text, StyleSheet } from 'react-native';
import { EmptyPage } from 'iconoir-react-native';
import { Attachment } from '../../main/models';
import { ThemeColors } from '../../../themes/types';

interface AttachmentItemProps {
    attachment: Attachment;
    onPress: (attachment: Attachment) => void;
    theme: ThemeColors;
    maxWidth?: number;
}

export const AttachmentItem: React.FC<AttachmentItemProps> = ({
    attachment,
    onPress,
    theme,
    maxWidth = 200,
}) => {
    const isImage = attachment.file_type?.startsWith('image/');

    // Helper to format source for Image
    const getImageSource = () => {
        if (attachment.uri) {
            return { uri: attachment.uri };
        }
        if (attachment.content) {
            // Check if content already has prefix
            if (attachment.content.startsWith('data:image')) {
                return { uri: attachment.content };
            }
            // Add prefix if missing
            return { uri: `data:${attachment.file_type || 'image/png'};base64,${attachment.content}` };
        }
        return undefined;
    };

    if (isImage) {
        return (
            <TouchableOpacity onPress={() => onPress(attachment)} style={styles.imageContainer}>
                <Image
                    source={getImageSource()}
                    style={[styles.image, { width: maxWidth, height: 150 }]}
                    resizeMode="cover"
                />
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity
            onPress={() => onPress(attachment)}
            style={[styles.fileContainer, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}
        >
            <View style={[styles.iconContainer, { backgroundColor: theme.primary + '20' }]}>
                <EmptyPage width={24} height={24} color={theme.primary} />
            </View>
            <View style={styles.fileInfo}>
                <Text style={[styles.fileName, { color: theme.textPrimary }]} numberOfLines={1}>
                    {attachment.file_name}
                </Text>
                <Text style={[styles.fileSize, { color: theme.textSecondary }]}>
                    {formatBytes(attachment.size)}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

function formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const styles = StyleSheet.create({
    imageContainer: {
        marginBottom: 8,
        borderRadius: 12,
        overflow: 'hidden',
    },
    image: {
        borderRadius: 12,
        backgroundColor: '#f0f0f0',
    },
    fileContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        borderRadius: 12,
        marginBottom: 8,
        borderWidth: 1,
        width: '100%',
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    fileInfo: {
        flex: 1,
    },
    fileName: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 2,
    },
    fileSize: {
        fontSize: 12,
    },
});
