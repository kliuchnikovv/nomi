import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Attachment } from '../../main/models';
import { AttachmentItem } from './AttachmentItem';
import { ThemeColors } from '../../../themes/types';

interface MessageAttachmentsProps {
    attachments: Attachment[];
    onAttachmentPress: (attachment: Attachment) => void;
    theme: ThemeColors;
    layout?: 'grid' | 'list';
    maxWidth?: number;
}

export const MessageAttachments: React.FC<MessageAttachmentsProps> = ({
    attachments,
    onAttachmentPress,
    theme,
    maxWidth,
}) => {
    if (!attachments || attachments.length === 0) {
        return null;
    }

    return (
        <View style={styles.container}>
            {attachments.map((attachment, index) => (
                <View key={attachment.id || index} style={styles.itemWrapper}>
                    <AttachmentItem
                        attachment={attachment}
                        onPress={onAttachmentPress}
                        theme={theme}
                        maxWidth={maxWidth}
                    />
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        paddingTop: 4,
    },
    itemWrapper: {
        marginBottom: 4,
    },
});
