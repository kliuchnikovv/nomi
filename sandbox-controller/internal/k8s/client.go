package k8s

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path/filepath"
	"time"

	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/config"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/sandbox"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/client-go/util/homedir"
)

// Client implements the sandbox.Backend interface using Kubernetes
type Client struct {
	clientset *kubernetes.Clientset
	config    *rest.Config
	namespace string
	cfg       *config.Config
}

// NewClient creates a new Kubernetes client
func NewClient(cfg *config.Config) (*Client, error) {
	var kubeConfig *rest.Config
	var err error

	if cfg.InCluster {
		kubeConfig, err = rest.InClusterConfig()
	} else if cfg.KubeconfigPath != "" {
		kubeConfig, err = clientcmd.BuildConfigFromFlags("", cfg.KubeconfigPath)
	} else {
		home := homedir.HomeDir()
		kubeConfig, err = clientcmd.BuildConfigFromFlags("", filepath.Join(home, ".kube", "config"))
	}

	if err != nil {
		return nil, fmt.Errorf("failed to build kubeconfig: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(kubeConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	return &Client{
		clientset: clientset,
		config:    kubeConfig,
		namespace: cfg.Namespace,
		cfg:       cfg,
	}, nil
}

// CreateSandbox creates a pod and PVC for the sandbox
func (c *Client) CreateSandbox(ctx context.Context, sb *sandbox.Sandbox) error {
	// Ensure PVC exists
	if err := c.ensurePVC(ctx, sb); err != nil {
		return fmt.Errorf("failed to ensure PVC: %w", err)
	}

	// Create pod
	if err := c.createPod(ctx, sb); err != nil {
		return fmt.Errorf("failed to create pod: %w", err)
	}

	return nil
}

// ensurePVC ensures the PVC exists for the sandbox
func (c *Client) ensurePVC(ctx context.Context, sb *sandbox.Sandbox) error {
	_, err := c.clientset.CoreV1().PersistentVolumeClaims(c.namespace).Get(ctx, sb.PVCName, metav1.GetOptions{})
	if err == nil {
		return nil // Already exists
	}

	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      sb.PVCName,
			Namespace: c.namespace,
			Labels: map[string]string{
				"app":        "genie-sandbox",
				"sandbox-id": sb.ID,
				"user-id":    sb.UserID,
			},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: resource.MustParse("1Gi"),
				},
			},
		},
	}

	_, err = c.clientset.CoreV1().PersistentVolumeClaims(c.namespace).Create(ctx, pvc, metav1.CreateOptions{})
	if err != nil {
		return err
	}

	return nil
}

// createPod creates the sandbox pod
func (c *Client) createPod(ctx context.Context, sb *sandbox.Sandbox) error {
	securityContext := &corev1.SecurityContext{
		RunAsNonRoot:             boolPtr(true),
		RunAsUser:                int64Ptr(1000),
		RunAsGroup:               int64Ptr(1000),
		ReadOnlyRootFilesystem:   boolPtr(false),
		AllowPrivilegeEscalation: boolPtr(false),
		Capabilities: &corev1.Capabilities{
			Drop: []corev1.Capability{"ALL"},
		},
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      sb.PodName,
			Namespace: c.namespace,
			Labels: map[string]string{
				"app":        "genie-sandbox",
				"sandbox-id": sb.ID,
				"user-id":    sb.UserID,
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name:  "sandbox",
					Image: c.cfg.DefaultImage,
					Command: []string{
						"sleep",
						"infinity",
					},
					SecurityContext: securityContext,
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse(c.cfg.MaxCPU),
							corev1.ResourceMemory: resource.MustParse(c.cfg.MaxMemory),
						},
					},
					VolumeMounts: []corev1.VolumeMount{
						{
							Name:      "workspace",
							MountPath: "/workspace",
						},
					},
					WorkingDir: "/workspace",
				},
			},
			Volumes: []corev1.Volume{
				{
					Name: "workspace",
					VolumeSource: corev1.VolumeSource{
						PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
							ClaimName: sb.PVCName,
						},
					},
				},
			},
			RestartPolicy: corev1.RestartPolicyNever,
		},
	}

	_, err := c.clientset.CoreV1().Pods(c.namespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return err
	}

	return nil
}

// DestroySandbox destroys the pod and optionally the PVC
func (c *Client) DestroySandbox(ctx context.Context, podName string, deletePVC bool) error {
	// Delete pod
	deletePolicy := metav1.DeletePropagationForeground
	if err := c.clientset.CoreV1().Pods(c.namespace).Delete(ctx, podName, metav1.DeleteOptions{
		PropagationPolicy: &deletePolicy,
	}); err != nil {
		return err
	}

	if deletePVC {
		// Get PVC name from pod
		pod, err := c.clientset.CoreV1().Pods(c.namespace).Get(ctx, podName, metav1.GetOptions{})
		if err == nil {
			for _, vol := range pod.Spec.Volumes {
				if vol.PersistentVolumeClaim != nil {
					pvcName := vol.PersistentVolumeClaim.ClaimName
					if err := c.clientset.CoreV1().PersistentVolumeClaims(c.namespace).Delete(ctx, pvcName, metav1.DeleteOptions{}); err != nil {
						return err
					}
					break
				}
			}
		}
	}

	return nil
}

// GetStatus returns the current status of the pod
func (c *Client) GetStatus(ctx context.Context, podName string) (*sandbox.PodStatus, error) {
	pod, err := c.clientset.CoreV1().Pods(c.namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	status := &sandbox.PodStatus{
		Phase:     string(pod.Status.Phase),
		StartTime: pod.Status.StartTime.Time,
	}

	// Check if pod is ready
	for _, cond := range pod.Status.Conditions {
		if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
			status.Ready = true
		}
	}

	if pod.Status.Message != "" {
		status.Message = pod.Status.Message
	}
	if pod.Status.Reason != "" {
		status.Reason = pod.Status.Reason
	}

	return status, nil
}

// Exec executes a command in the sandbox
func (c *Client) Exec(ctx context.Context, podName string, command []string, timeout time.Duration) (*sandbox.ExecResult, error) {
	req := c.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Name(podName).
		Namespace(c.namespace).
		SubResource("exec").
		Param("container", "sandbox").
		Param("stdin", "false").
		Param("stdout", "true").
		Param("stderr", "true").
		Param("tty", "false")

	for _, cmd := range command {
		req.Param("command", cmd)
	}

	exec, err := remotecommand.NewSPDYExecutor(c.config, "POST", req.URL())
	if err != nil {
		return nil, fmt.Errorf("failed to create executor: %w", err)
	}

	var stdout, stderr bytes.Buffer

	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
	})

	result := &sandbox.ExecResult{
		Stdout: stdout.String(),
		Stderr: stderr.String(),
	}

	if err != nil {
		result.ExitCode = 1
	}

	return result, nil
}

// ExecStream executes a command and streams the output
func (c *Client) ExecStream(ctx context.Context, podName string, command []string) (io.ReadCloser, error) {
	req := c.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Name(podName).
		Namespace(c.namespace).
		SubResource("exec").
		Param("container", "sandbox").
		Param("stdin", "false").
		Param("stdout", "true").
		Param("stderr", "true").
		Param("tty", "false")

	for _, cmd := range command {
		req.Param("command", cmd)
	}

	exec, err := remotecommand.NewSPDYExecutor(c.config, "POST", req.URL())
	if err != nil {
		return nil, fmt.Errorf("failed to create executor: %w", err)
	}

	reader, writer := io.Pipe()

	go func() {
		defer writer.Close()
		exec.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdout: writer,
			Stderr: writer,
		})
	}()

	return reader, nil
}

// Upload copies data to a file in the sandbox
func (c *Client) Upload(ctx context.Context, podName string, path string, data io.Reader) error {
	// Use exec to write file
	cmd := []string{"sh", "-c", fmt.Sprintf("cat > %s", path)}

	req := c.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Name(podName).
		Namespace(c.namespace).
		SubResource("exec").
		Param("container", "sandbox").
		Param("stdin", "true").
		Param("stdout", "true").
		Param("stderr", "true").
		Param("tty", "false")

	for _, c := range cmd {
		req.Param("command", c)
	}

	exec, err := remotecommand.NewSPDYExecutor(c.config, "POST", req.URL())
	if err != nil {
		return fmt.Errorf("failed to create executor: %w", err)
	}

	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin: data,
	})

	return err
}

// Download reads a file from the sandbox
func (c *Client) Download(ctx context.Context, podName string, path string) (io.ReadCloser, error) {
	cmd := []string{"cat", path}

	req := c.clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Name(podName).
		Namespace(c.namespace).
		SubResource("exec").
		Param("container", "sandbox").
		Param("stdin", "false").
		Param("stdout", "true").
		Param("stderr", "true").
		Param("tty", "false")

	for _, c := range cmd {
		req.Param("command", c)
	}

	exec, err := remotecommand.NewSPDYExecutor(c.config, "POST", req.URL())
	if err != nil {
		return nil, fmt.Errorf("failed to create executor: %w", err)
	}

	reader, writer := io.Pipe()

	go func() {
		defer writer.Close()
		var stderr bytes.Buffer
		exec.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdout: writer,
			Stderr: &stderr,
		})
	}()

	return reader, nil
}

// ListFiles lists files in a directory
func (c *Client) ListFiles(ctx context.Context, podName string, path string) ([]sandbox.FileInfo, error) {
	cmd := []string{"ls", "-la", path}

	result, err := c.Exec(ctx, podName, cmd, 30*time.Second)
	if err != nil {
		return nil, err
	}

	// Parse ls output
	_ = result // TODO: Implement proper parsing of ls output
	files := []sandbox.FileInfo{}
	return files, nil
}

func boolPtr(b bool) *bool {
	return &b
}

func int64Ptr(i int64) *int64 {
	return &i
}
